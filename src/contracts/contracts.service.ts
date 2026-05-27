import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { addDays, addMonths, format, parseISO, startOfMonth } from 'date-fns';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateContractDto,
  FilterContractsDto,
  RenewContractDto,
  TerminateContractDto,
} from './dto/contract.dto';
import { buildPaginationMeta } from '../common/dto/pagination.dto';
import { ContractStatus, PaymentStatus, PropertyStatus, Role } from '@prisma/client';

@Injectable()
export class ContractsService {
  constructor(private prisma: PrismaService) {}

  async list(userId: string, role: string, query: FilterContractsDto) {
    const { page = 1, limit = 20, status, propertyId, tenantId } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (role === Role.TENANT) {
      const tenant = await this.prisma.tenant.findFirst({ where: { userId } });
      if (tenant) where.tenantId = tenant.id;
      else return { data: [], meta: buildPaginationMeta(0, page, limit) };
    } else if (role !== Role.ADMIN) {
      where.property = { ownerId: userId };
    }

    if (status) where.status = status;
    if (propertyId) where.propertyId = propertyId;
    if (tenantId) where.tenantId = tenantId;

    const [data, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        skip,
        take: limit,
        include: {
          property: { select: { id: true, title: true, images: { where: { isCover: true }, take: 1 } } },
          tenant: { select: { id: true, lastName: true, firstName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.contract.count({ where }),
    ]);

    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async create(userId: string, role: string, dto: CreateContractDto) {
    const property = await this.prisma.property.findFirst({
      where: { id: dto.propertyId, deletedAt: null },
    });
    if (!property) throw new NotFoundException('Bien introuvable.');

    if (role !== Role.ADMIN && property.ownerId !== userId && property.managerId !== userId) {
      throw new ForbiddenException({ error: 'INSUFFICIENT_PERMISSIONS', message: 'Droits insuffisants.' });
    }

    if (!([PropertyStatus.AVAILABLE, PropertyStatus.RESERVED] as PropertyStatus[]).includes(property.status)) {
      throw new ConflictException({ error: 'PROPERTY_NOT_AVAILABLE', message: 'Le bien n\'est pas disponible.' });
    }

    const existingActive = await this.prisma.contract.findFirst({
      where: { propertyId: dto.propertyId, status: ContractStatus.ACTIVE },
    });
    if (existingActive) {
      throw new ConflictException('Un contrat actif existe déjà pour ce bien.');
    }

    const clauseData = (dto.clauses || []).map((text, order) => ({ text, order }));

    const contract = await this.prisma.contract.create({
      data: {
        propertyId: dto.propertyId,
        tenantId: dto.tenantId,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        rent: dto.rent,
        fees: dto.fees ?? 0,
        deposit: dto.deposit,
        status: ContractStatus.ACTIVE,
        clauses: { create: clauseData },
      },
      include: { clauses: true },
    });

    await this.prisma.property.update({
      where: { id: dto.propertyId },
      data: { status: PropertyStatus.RENTED },
    });

    await this.generatePaymentSchedule(contract.id, dto.tenantId, dto.propertyId, dto.rent, dto.fees ?? 0, new Date(dto.startDate), new Date(dto.endDate));

    await this.prisma.notification.create({
      data: {
        userId: dto.tenantId,
        type: 'contract_created',
        title: 'Nouveau contrat',
        body: 'Un contrat de location a été créé pour vous.',
      },
    });

    return contract;
  }

  async getById(id: string, userId: string, role: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id },
      include: {
        property: { include: { images: { where: { isCover: true }, take: 1 } } },
        tenant: true,
        clauses: { orderBy: { order: 'asc' } },
        payments: { orderBy: { dueDate: 'asc' } },
      },
    });
    if (!contract) throw new NotFoundException('Contrat introuvable.');
    await this.assertAccess(contract, userId, role);
    return contract;
  }

  async renew(id: string, userId: string, role: string, dto: RenewContractDto) {
    const contract = await this.getById(id, userId, role);
    if (!([ContractStatus.ACTIVE, ContractStatus.EXPIRED] as ContractStatus[]).includes(contract.status)) {
      throw new ConflictException({ error: 'CONTRACT_NOT_RENEWABLE', message: 'Le contrat ne peut pas être renouvelé.' });
    }

    const oldEndDate = new Date(contract.endDate);
    const newStartDate = addDays(oldEndDate, 1);

    await this.prisma.contract.update({ where: { id }, data: { status: ContractStatus.RENEWAL } });

    const newRent = dto.rent ?? contract.rent;
    const clauseData = (dto.clauses || []).map((text, order) => ({ text, order }));

    const newContract = await this.prisma.contract.create({
      data: {
        propertyId: contract.propertyId,
        tenantId: contract.tenantId,
        startDate: newStartDate,
        endDate: new Date(dto.endDate),
        rent: newRent,
        fees: contract.fees,
        deposit: contract.deposit,
        parentContractId: id,
        status: ContractStatus.ACTIVE,
        clauses: { create: clauseData },
      },
    });

    await this.generatePaymentSchedule(newContract.id, contract.tenantId, contract.propertyId, newRent, contract.fees, newStartDate, new Date(dto.endDate));

    return newContract;
  }

  async terminate(id: string, userId: string, role: string, dto: TerminateContractDto) {
    const contract = await this.getById(id, userId, role);

    await this.prisma.contract.update({ where: { id }, data: { status: ContractStatus.TERMINATED } });

    const terminationDate = new Date(dto.terminationDate);
    await this.prisma.payment.updateMany({
      where: { contractId: id, status: PaymentStatus.PENDING, dueDate: { gt: terminationDate } },
      data: { status: PaymentStatus.CANCELLED },
    });

    await this.prisma.property.update({
      where: { id: contract.propertyId },
      data: { status: PropertyStatus.AVAILABLE },
    });

    await this.prisma.notification.create({
      data: {
        userId: contract.tenantId,
        type: 'contract_terminated',
        title: 'Contrat résilié',
        body: 'Votre contrat de location a été résilié.',
      },
    });

    return { message: 'Contrat résilié avec succès.' };
  }

  async getPdfUrl(id: string, userId: string, role: string) {
    const contract = await this.getById(id, userId, role);
    if (!contract.pdfUrl) throw new NotFoundException('PDF non disponible.');
    return { pdfUrl: contract.pdfUrl };
  }

  async generateReceipts(id: string, userId: string, role: string, period: string) {
    const contract = await this.getById(id, userId, role);
    const payments = await this.prisma.payment.findMany({
      where: { contractId: id, period, status: PaymentStatus.PAID },
    });
    return { generated: payments.length, message: 'Quittances générées (tâche asynchrone).' };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async generatePaymentSchedule(
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
      const monthLabel = format(current, 'MMMM yyyy');
      const dueDate = new Date(current.getFullYear(), current.getMonth(), 5);

      payments.push({
        contractId,
        tenantId,
        propertyId,
        amount: rent + fees,
        period: monthLabel,
        dueDate,
        status: PaymentStatus.PENDING,
      });

      current = addMonths(current, 1);
    }

    await this.prisma.payment.createMany({ data: payments });
  }

  private async assertAccess(contract: any, userId: string, role: string) {
    if (role === Role.ADMIN) return;
    if (role === Role.TENANT) {
      const tenant = await this.prisma.tenant.findFirst({ where: { userId } });
      if (!tenant || tenant.id !== contract.tenantId) {
        throw new ForbiddenException({ error: 'INSUFFICIENT_PERMISSIONS', message: 'Droits insuffisants.' });
      }
      return;
    }
    const property = await this.prisma.property.findUnique({ where: { id: contract.propertyId } });
    if (!property || (property.ownerId !== userId && property.managerId !== userId)) {
      throw new ForbiddenException({ error: 'INSUFFICIENT_PERMISSIONS', message: 'Droits insuffisants.' });
    }
  }
}
