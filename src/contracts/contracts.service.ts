import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { addDays, addMonths, format } from 'date-fns';
import {
  Contract,
  ContractStatus,
  PaymentStatus,
  PropertyStatus,
  Role,
} from '@prisma/client';
import { BaseService } from '../common/abstractions/base.service';
import type { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import type { SearchRequest } from '../common/interfaces/search-request.interface';
import { PdfService } from '../common/services/pdf.service';
import { StorageService } from '../storage/storage.service';
import { UnitOfWorkService } from '../database/unit-of-work.service';
import {
  CreateContractDto,
  RenewContractDto,
  TerminateContractDto,
} from './dto/contract.dto';
import { ContractCreateData, ContractRepository } from './contract.repository';

const TVA_RATE = 19.25;

@Injectable()
export class ContractsService extends BaseService<Contract, ContractCreateData> {
  constructor(
    protected override readonly repository: ContractRepository,
    private readonly uow: UnitOfWorkService,
    private readonly pdfService: PdfService,
    private readonly storage: StorageService,
  ) {
    super(repository);
  }

  async search(userId: string, role: string, query: SearchRequest): Promise<PaginatedResult<Contract>> {
    const baseWhere = await this.buildRoleWhere(userId, role);
    return this.findWithPagination(query, baseWhere);
  }

  async createContract(userId: string, role: string, dto: CreateContractDto): Promise<Contract> {
    const property = await this.repository.findPropertyForContract(dto.propertyId);
    if (!property) throw new NotFoundException('Bien introuvable.');

    if (role !== Role.ADMIN && property.ownerId !== userId && property.managerId !== userId) {
      throw new ForbiddenException({ error: 'INSUFFICIENT_PERMISSIONS', message: 'Droits insuffisants.' });
    }

    const availableStatuses: PropertyStatus[] = [PropertyStatus.AVAILABLE, PropertyStatus.RESERVED];
    if (!availableStatuses.includes(property.status)) {
      throw new ConflictException({ error: 'PROPERTY_NOT_AVAILABLE', message: "Le bien n'est pas disponible." });
    }

    const existingActive = await this.repository.findActiveContractForProperty(dto.propertyId);
    if (existingActive) throw new ConflictException('Un contrat actif existe déjà pour ce bien.');

    const clauseData = (dto.clauses ?? []).map((text, order) => ({ text, order }));
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    const fees = dto.fees ?? 0;

    return this.uow.execute(async (tx) => {
      const contract = await tx.contract.create({
        data: {
          propertyId: dto.propertyId,
          tenantId: dto.tenantId,
          startDate: start,
          endDate: end,
          rent: dto.rent,
          fees,
          deposit: dto.deposit,
          status: ContractStatus.ACTIVE,
          clauses: { create: clauseData },
        },
        include: { clauses: true },
      });

      await tx.property.update({
        where: { id: dto.propertyId },
        data: { status: PropertyStatus.RENTED },
      });

      await tx.payment.createMany({
        data: this.buildPaymentSchedule(contract.id, dto.tenantId, dto.propertyId, dto.rent, fees, start, end),
      });

      await tx.notification.create({
        data: {
          userId: dto.tenantId,
          type: 'contract_created',
          title: 'Nouveau contrat',
          body: 'Un contrat de location a été créé pour vous.',
        },
      });

      return contract as unknown as Contract;
    });
  }

  async getById(id: string, userId: string, role: string): Promise<Contract> {
    const contract = await this.repository.findByIdWithDetails(id);
    if (!contract) throw new NotFoundException('Contrat introuvable.');
    await this.checkAccess(contract, userId, role);
    return contract;
  }

  async renew(id: string, userId: string, role: string, dto: RenewContractDto): Promise<Contract> {
    const contract = await this.getById(id, userId, role);

    const renewableStatuses: ContractStatus[] = [ContractStatus.ACTIVE, ContractStatus.EXPIRED];
    if (!renewableStatuses.includes((contract as never as { status: ContractStatus }).status)) {
      throw new ConflictException({ error: 'CONTRACT_NOT_RENEWABLE', message: 'Le contrat ne peut pas être renouvelé.' });
    }

    const oldEndDate = new Date((contract as never as { endDate: Date }).endDate);
    const newStartDate = addDays(oldEndDate, 1);
    const newRent = dto.rent ?? (contract as never as { rent: number }).rent;
    const clauseData = (dto.clauses ?? []).map((text, order) => ({ text, order }));

    return this.uow.execute(async (tx) => {
      await tx.contract.update({ where: { id }, data: { status: ContractStatus.RENEWAL } });

      const c = contract as never as { tenantId: string; propertyId: string; fees: number; deposit: number };
      const newContract = await tx.contract.create({
        data: {
          propertyId: c.propertyId,
          tenantId: c.tenantId,
          startDate: newStartDate,
          endDate: new Date(dto.endDate),
          rent: newRent,
          fees: c.fees,
          deposit: c.deposit,
          parentContractId: id,
          status: ContractStatus.ACTIVE,
          clauses: { create: clauseData },
        },
      });

      await tx.payment.createMany({
        data: this.buildPaymentSchedule(
          newContract.id,
          c.tenantId,
          c.propertyId,
          newRent,
          c.fees,
          newStartDate,
          new Date(dto.endDate),
        ),
      });

      return newContract as unknown as Contract;
    });
  }

  async terminate(
    id: string,
    userId: string,
    role: string,
    dto: TerminateContractDto,
  ): Promise<{ message: string }> {
    const contract = await this.getById(id, userId, role);
    const c = contract as never as { propertyId: string; tenantId: string };
    const terminationDate = new Date(dto.terminationDate);

    await this.uow.execute(async (tx) => {
      await tx.contract.update({ where: { id }, data: { status: ContractStatus.TERMINATED } });

      await tx.payment.updateMany({
        where: { contractId: id, status: PaymentStatus.PENDING, dueDate: { gt: terminationDate } },
        data: { status: PaymentStatus.CANCELLED },
      });

      await tx.property.update({
        where: { id: c.propertyId },
        data: { status: PropertyStatus.AVAILABLE },
      });

      await tx.notification.create({
        data: {
          userId: c.tenantId,
          type: 'contract_terminated',
          title: 'Contrat résilié',
          body: 'Votre contrat de location a été résilié.',
        },
      });
    });

    return { message: 'Contrat résilié avec succès.' };
  }

  async getPdfUrl(id: string, userId: string, role: string, force = false): Promise<{ pdfUrl: string }> {
    const contract = await this.getById(id, userId, role);
    const existingUrl = (contract as never as { pdfUrl: string | null }).pdfUrl;

    if (existingUrl && !force) return { pdfUrl: existingUrl };

    const data = await this.repository.findByIdForPdf(id);
    if (!data) throw new NotFoundException('Contrat introuvable.');

    const tvaAmount = Math.round(data.rent * TVA_RATE / 100);

    const pdfBuffer = await this.pdfService.generateContractPdf({
      contractId: id,
      ownerFirstName: data.property.owner.firstName,
      ownerLastName: data.property.owner.lastName,
      tenantFirstName: data.tenant.firstName,
      tenantLastName: data.tenant.lastName,
      tenantIdNumber: data.tenant.nationalIdNumber,
      propertyTitle: data.property.title,
      propertyAddress: data.property.address,
      propertyCity: data.property.city,
      startDate: data.startDate,
      endDate: data.endDate,
      rentHT: data.rent,
      tvaRate: TVA_RATE,
      tvaAmount,
      rentTTC: data.rent + tvaAmount,
      fees: data.fees,
      deposit: data.deposit,
      clauses: data.clauses.map((c) => c.text),
    });

    const key = `contracts/${id}/contract.pdf`;
    const pdfUrl = await this.storage.uploadBuffer(key, pdfBuffer, 'application/pdf');
    await this.repository.updatePdfUrl(id, pdfUrl);

    return { pdfUrl };
  }

  async generateReceipts(
    id: string,
    userId: string,
    role: string,
    period: string,
  ): Promise<{ generated: number; message: string }> {
    await this.getById(id, userId, role);
    // TODO: trigger BullMQ job for async PDF generation
    return { generated: 0, message: 'Quittances générées (tâche asynchrone).' };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async checkAccess(contract: Contract, userId: string, role: string): Promise<void> {
    if (role === Role.ADMIN) return;
    if (role === Role.TENANT) {
      const tenant = await this.repository.findTenantByUserId(userId);
      if (!tenant || tenant.id !== (contract as never as { tenantId: string }).tenantId) {
        throw new ForbiddenException({ error: 'INSUFFICIENT_PERMISSIONS', message: 'Droits insuffisants.' });
      }
      return;
    }
    const property = await this.repository.findPropertyById((contract as never as { propertyId: string }).propertyId);
    if (!property || (property.ownerId !== userId && property.managerId !== userId)) {
      throw new ForbiddenException({ error: 'INSUFFICIENT_PERMISSIONS', message: 'Droits insuffisants.' });
    }
  }

  private async buildRoleWhere(userId: string, role: string): Promise<Record<string, unknown>> {
    const where: Record<string, unknown> = {};
    if (role === Role.TENANT) {
      const tenant = await this.repository.findTenantByUserId(userId);
      if (tenant) where.tenantId = tenant.id;
      else where.id = 'never';
    } else if (role !== Role.ADMIN) {
      where.property = { ownerId: userId };
    }
    return where;
  }

  private buildPaymentSchedule(
    contractId: string,
    tenantId: string,
    propertyId: string,
    rent: number,
    fees: number,
    startDate: Date,
    endDate: Date,
  ) {
    const payments: {
      contractId: string;
      tenantId: string;
      propertyId: string;
      amount: number;
      period: string;
      dueDate: Date;
      status: PaymentStatus;
    }[] = [];
    let current = startDate;

    while (current <= endDate) {
      const dueDate = new Date(current.getFullYear(), current.getMonth(), 5);
      payments.push({
        contractId,
        tenantId,
        propertyId,
        amount: rent + fees,
        period: format(current, 'MMMM yyyy'),
        dueDate,
        status: PaymentStatus.PENDING,
      });
      current = addMonths(current, 1);
    }

    return payments;
  }
}
