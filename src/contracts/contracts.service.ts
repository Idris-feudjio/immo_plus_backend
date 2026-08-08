import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { addDays } from 'date-fns';
import {
  Contract,
  ContractStatus,
  Prisma,
  PaymentStatus,
  PropertyStatus,
  Role,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { BaseService } from '../common/abstractions/base.service';
import type { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import type { ISearchRequest } from '../common/interfaces/search-request.interface';
import { PdfService } from '../common/services/pdf.service';
import type { ContractPdfVm } from '../common/services/pdf-view-models';
import { StorageService } from '../storage/storage.service';
import { UnitOfWorkService } from '../database/unit-of-work.service';
import { EmailQueueService } from '../notifications/email-queue.service';
import { ContractTemplatesService } from '../contract-templates/contract-templates.service';
import {
  CreateContractDto,
  RenewContractDto,
  TerminateContractDto,
} from './dto/contract.dto';
import { ContractCreateData, ContractRepository } from './contract.repository';

const TVA_RATE = 19.25;
const SIGNATURE_TOKEN_EXPIRY_DAYS = 7;
const PDF_GENERATION_TIMEOUT_MS = 30000;

type AcceptanceResolution =
  | { kind: 'pending'; contract: Contract }
  | { kind: 'already_accepted'; contract: Contract };

// Response shapes consumed verbatim by the public AcceptContractPage frontend.
type AcceptanceSummaryResponse =
  | { status: 'already_accepted' }
  | {
      status: 'pending';
      propertyTitle: string;
      propertyCity: string;
      tenantName: string;
      rent: number;
      startDate: string;
      endDate: string;
    };

type AcceptContractResponse =
  | { status: 'accepted' }
  | { status: 'already_accepted' };

@Injectable()
export class ContractsService extends BaseService<
  Contract,
  ContractCreateData
> {
  private readonly logger = new Logger(ContractsService.name);

  constructor(
    protected override readonly repository: ContractRepository,
    private readonly uow: UnitOfWorkService,
    private readonly pdfService: PdfService,
    private readonly storage: StorageService,
    private readonly emailQueue: EmailQueueService,
    private readonly contractTemplates: ContractTemplatesService,
  ) {
    super(repository);
  }

  async search(
    userId: string,
    role: string,
    query: ISearchRequest,
  ): Promise<PaginatedResult<Contract>> {
    const baseWhere = await this.buildRoleWhere(userId, role);
    return this.findWithPagination(query, baseWhere);
  }

  async createContract(
    userId: string,
    role: string,
    dto: CreateContractDto,
  ): Promise<Contract> {
    const property = await this.repository.findPropertyForContract(
      dto.propertyId,
    );
    if (!property) throw new NotFoundException('Bien introuvable.');

    if (
      role !== Role.ADMIN &&
      property.ownerId !== userId &&
      property.managerId !== userId
    ) {
      throw new ForbiddenException({
        error: 'INSUFFICIENT_PERMISSIONS',
        message: 'Droits insuffisants.',
      });
    }

    if (property.status !== PropertyStatus.AVAILABLE) {
      throw new ConflictException({
        error: 'PROPERTY_NOT_AVAILABLE',
        message: "Le bien n'est pas disponible.",
      });
    }

    const tenant = await this.repository.findTenantById(dto.tenantId);
    if (!tenant) throw new NotFoundException('Locataire introuvable.');

    const acceptedApplication = await this.repository.findAcceptedApplication(
      dto.propertyId,
      tenant.email,
    );
    if (!acceptedApplication) {
      throw new ConflictException({
        error: 'NO_ACCEPTED_APPLICATION',
        message: "Ce locataire n'a pas de candidature acceptée pour ce bien.",
      });
    }

    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    this.assertDateRange(start, end);

    const clauseData = await this.resolveClauseData(
      dto.templateId,
      dto.clauses,
      userId,
      role,
    );
    const fees = dto.fees ?? 0;
    const tvaAmount = Math.round((dto.rent * TVA_RATE) / 100);

    return this.uow.execute(async (tx) => {
      const existingActive = await tx.contract.findFirst({
        where: { propertyId: dto.propertyId, status: ContractStatus.ACTIVE },
      });
      if (existingActive) {
        throw new ConflictException({
          error: 'ACTIVE_CONTRACT_EXISTS',
          message: 'Un contrat actif existe déjà pour ce bien.',
        });
      }

      const contract = await tx.contract.create({
        data: {
          propertyId: dto.propertyId,
          tenantId: dto.tenantId,
          startDate: start,
          endDate: end,
          rent: dto.rent,
          fees,
          deposit: dto.deposit,
          tvaRate: TVA_RATE,
          tvaAmount,
          status: ContractStatus.DRAFT,
          clauses: { create: clauseData },
        },
        include: { clauses: true },
      });

      return contract;
    }, Prisma.TransactionIsolationLevel.Serializable);
  }

  async getById(id: string, userId: string, role: string): Promise<Contract> {
    const contract = await this.repository.findByIdWithDetails(id);
    if (!contract) throw new NotFoundException('Contrat introuvable.');
    await this.checkAccess(contract, userId, role);
    return contract;
  }

  // ── Story 5.4 — public acceptance flow ───────────────────────────────────────

  async getAcceptanceSummary(
    token: string,
  ): Promise<AcceptanceSummaryResponse> {
    const resolution = await this.resolveContractByToken(token);
    if (resolution.kind === 'already_accepted')
      return { status: 'already_accepted' };

    const c = resolution.contract as never as {
      rent: number;
      startDate: Date;
      endDate: Date;
      property: { title: string; city: string };
      tenant: { firstName: string; lastName: string };
    };
    return {
      status: 'pending',
      propertyTitle: c.property.title,
      propertyCity: c.property.city,
      tenantName: `${c.tenant.firstName} ${c.tenant.lastName}`,
      rent: c.rent,
      startDate: c.startDate.toISOString(),
      endDate: c.endDate.toISOString(),
    };
  }

  async acceptContract(
    token: string,
    ip: string,
  ): Promise<AcceptContractResponse> {
    const resolution = await this.resolveContractByToken(token);
    if (resolution.kind === 'already_accepted') {
      return { status: 'already_accepted' };
    }

    const contract = resolution.contract;
    const c = contract as never as {
      id: string;
      propertyId: string;
      parentContractId: string | null;
    };

    let alreadyProcessed = false;

    await this.uow.execute(async (tx) => {
      const accepted = await tx.contract.updateMany({
        where: { id: c.id, status: ContractStatus.PENDING_SIGNATURE },
        data: {
          status: ContractStatus.ACTIVE,
          acceptedAt: new Date(),
          acceptedIp: ip,
        },
      });
      if (accepted.count === 0) {
        // Lost the race to a concurrent acceptance of the same token — not an
        // error from the tenant's point of view, they just see "already accepted".
        alreadyProcessed = true;
        return;
      }

      if (c.parentContractId) {
        // Renewal: the property is normally already RENTED under the parent contract.
        // Claim it defensively (no-op if already RENTED) — the parent may have been
        // expired or terminated in the meantime, releasing the property.
        const activeOther = await tx.contract.findFirst({
          where: {
            propertyId: c.propertyId,
            status: ContractStatus.ACTIVE,
            id: { not: c.parentContractId },
          },
          select: { id: true },
        });
        if (activeOther) {
          throw new ConflictException({
            error: 'PROPERTY_ALREADY_RENTED',
            message: 'Le bien est déjà loué par un autre contrat.',
          });
        }

        await tx.property.updateMany({
          where: { id: c.propertyId, status: { not: PropertyStatus.RENTED } },
          data: { status: PropertyStatus.RENTED },
        });

        const parentResult = await tx.contract.updateMany({
          where: { id: c.parentContractId, status: ContractStatus.RENEWAL },
          data: { status: ContractStatus.EXPIRED },
        });
        if (parentResult.count === 0) {
          this.logger.warn(
            `Renewal accepted for contract ${c.id} but parent ${c.parentContractId} was not in RENEWAL status.`,
          );
        }
      } else {
        const propertyResult = await tx.property.updateMany({
          where: { id: c.propertyId, status: { not: PropertyStatus.RENTED } },
          data: { status: PropertyStatus.RENTED },
        });
        if (propertyResult.count === 0) {
          throw new ConflictException({
            error: 'PROPERTY_ALREADY_RENTED',
            message: 'Le bien est déjà loué par un autre contrat.',
          });
        }
      }
    });

    if (alreadyProcessed) {
      return { status: 'already_accepted' };
    }

    this.sendSignedCopyEmail(c.id).catch((err: unknown) => {
      this.logger.warn(
        `Failed to send signed copy email for contract ${c.id}: ${String(err)}`,
      );
    });

    return { status: 'accepted' };
  }

  private async resolveContractByToken(
    token: string,
  ): Promise<AcceptanceResolution> {
    const contract = await this.repository.findBySignatureToken(token);
    if (!contract)
      throw new NotFoundException({
        error: 'INVALID_TOKEN',
        message: 'Lien de signature invalide.',
      });

    const c = contract as never as {
      status: ContractStatus;
      signatureTokenExpiresAt: Date | null;
    };

    if (c.status === ContractStatus.ACTIVE) {
      return { kind: 'already_accepted', contract };
    }

    const expired =
      c.status !== ContractStatus.PENDING_SIGNATURE ||
      !c.signatureTokenExpiresAt ||
      c.signatureTokenExpiresAt < new Date();

    if (expired) {
      throw new BadRequestException({
        error: 'ACCEPTANCE_LINK_EXPIRED',
        message:
          'Ce lien de signature a expiré. Veuillez contacter le propriétaire ou le gestionnaire.',
      });
    }

    return { kind: 'pending', contract };
  }

  private async sendSignedCopyEmail(contractId: string): Promise<void> {
    const data = await this.repository.findByIdForPdf(contractId);
    if (!data) return;

    const lang = (data.pdfLang as 'fr' | 'en' | null) ?? 'fr';
    const buffer = await this.generatePdfWithTimeout(() =>
      this.pdfService.generateContractPdf(
        this.buildPdfVm(contractId, data, lang),
      ),
    );

    await this.emailQueue.sendEmail({
      to: data.tenant.email,
      subject:
        lang === 'fr' ? 'Votre contrat signé' : 'Your signed lease agreement',
      template: 'contract-accepted',
      data: {
        message:
          lang === 'fr'
            ? 'Veuillez trouver ci-joint votre contrat signé.'
            : 'Please find your signed lease agreement attached.',
      },
      attachment: {
        filename: `contrat-${contractId}.pdf`,
        contentBase64: buffer.toString('base64'),
        contentType: 'application/pdf',
      },
    });
  }

  // ── Story 5.5 — renewal ───────────────────────────────────────────────────────

  async renew(
    id: string,
    userId: string,
    role: string,
    dto: RenewContractDto,
  ): Promise<Contract> {
    const contract = await this.getById(id, userId, role);

    const renewableStatuses: ContractStatus[] = [
      ContractStatus.ACTIVE,
      ContractStatus.EXPIRED,
    ];
    const c = contract as never as {
      status: ContractStatus;
      endDate: Date;
      rent: number;
      tenantId: string;
      propertyId: string;
      fees: number;
      deposit: number;
    };
    if (!renewableStatuses.includes(c.status)) {
      throw new ConflictException({
        error: 'CONTRACT_NOT_RENEWABLE',
        message: 'Le contrat ne peut pas être renouvelé.',
      });
    }

    const oldEndDate = new Date(c.endDate);
    const newStartDate = addDays(oldEndDate, 1);
    const newEndDate = new Date(dto.endDate);
    this.assertDateRange(newStartDate, newEndDate);

    const newRent = dto.rent ?? c.rent;
    const clauseData = (dto.clauses ?? []).map((text, order) => ({
      text,
      order,
    }));
    const tvaAmount = Math.round((newRent * TVA_RATE) / 100);

    return this.uow.execute(async (tx) => {
      const guarded = await tx.contract.updateMany({
        where: { id, status: { in: renewableStatuses } },
        data: { status: ContractStatus.RENEWAL },
      });
      if (guarded.count === 0) {
        throw new ConflictException({
          error: 'CONTRACT_NOT_RENEWABLE',
          message: 'Le contrat ne peut pas être renouvelé.',
        });
      }

      const newContract = await tx.contract.create({
        data: {
          propertyId: c.propertyId,
          tenantId: c.tenantId,
          startDate: newStartDate,
          endDate: newEndDate,
          rent: newRent,
          fees: c.fees,
          deposit: c.deposit,
          tvaRate: TVA_RATE,
          tvaAmount,
          parentContractId: id,
          status: ContractStatus.DRAFT,
          clauses: { create: clauseData },
        },
      });

      return newContract;
    });
  }

  // ── Story 5.6 — termination ────────────────────────────────────────────────────

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
      const guarded = await tx.contract.updateMany({
        where: { id, status: ContractStatus.ACTIVE },
        data: { status: ContractStatus.TERMINATED },
      });
      if (guarded.count === 0) {
        throw new ConflictException({
          error: 'CONTRACT_NOT_ACTIVE',
          message: "Le contrat n'est pas actif.",
        });
      }

      await tx.payment.updateMany({
        where: {
          contractId: id,
          status: PaymentStatus.PENDING,
          dueDate: { gt: terminationDate },
        },
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

    this.sendTerminationEmail(id, dto).catch((err: unknown) => {
      this.logger.warn(
        `Failed to send termination email for contract ${id}: ${String(err)}`,
      );
    });

    return { message: 'Contrat résilié avec succès.' };
  }

  private async sendTerminationEmail(
    contractId: string,
    dto: TerminateContractDto,
  ): Promise<void> {
    const data = await this.repository.findByIdForPdf(contractId);
    if (!data) return;

    await this.emailQueue.sendEmail({
      to: data.tenant.email,
      subject: 'Résiliation de votre contrat de location',
      template: 'contract-terminated',
      data: {
        message: `Votre contrat de location pour "${data.property.title}" a été résilié, avec effet au ${dto.terminationDate}.`,
      },
    });
  }

  // ── Story 5.3 — bilingual PDF + signature request ────────────────────────────

  async getPdfUrl(
    id: string,
    userId: string,
    role: string,
    lang: 'fr' | 'en' = 'fr',
    force = false,
  ): Promise<{ pdfUrl: string }> {
    const contract = await this.getById(id, userId, role);
    const c = contract as never as {
      status: ContractStatus;
      pdfUrl: string | null;
      pdfLang: string | null;
    };

    const key = `contracts/${id}/contract.pdf`;
    const needsRegeneration = force || !c.pdfUrl || c.pdfLang !== lang;

    if (needsRegeneration) {
      const data = await this.repository.findByIdForPdf(id);
      if (!data) throw new NotFoundException('Contrat introuvable.');

      const buffer = await this.generatePdfWithTimeout(() =>
        this.pdfService.generateContractPdf(this.buildPdfVm(id, data, lang)),
      );
      await this.storage.uploadBuffer(key, buffer, 'application/pdf');

      const willTransition =
        c.status === ContractStatus.DRAFT && role !== Role.TENANT;
      const signatureToken = willTransition
        ? randomBytes(32).toString('hex')
        : undefined;

      await this.uow.execute(async (tx) => {
        const updateData: Prisma.ContractUpdateInput = {
          pdfUrl: key,
          pdfLang: lang,
        };
        if (willTransition) {
          updateData.status = ContractStatus.PENDING_SIGNATURE;
          updateData.signatureToken = signatureToken;
          updateData.signatureTokenExpiresAt = addDays(
            new Date(),
            SIGNATURE_TOKEN_EXPIRY_DAYS,
          );
        }

        await tx.contract.updateMany({
          where: { id, status: c.status },
          data: updateData,
        });
      });

      if (willTransition && signatureToken) {
        this.sendAcceptanceEmail(id, signatureToken, lang).catch(
          (err: unknown) => {
            this.logger.warn(
              `Failed to send acceptance email for contract ${id}: ${String(err)}`,
            );
          },
        );
      }
    }

    return { pdfUrl: await this.storage.getSignedUrl(key, 24 * 3600) };
  }

  private async sendAcceptanceEmail(
    contractId: string,
    token: string,
    lang: 'fr' | 'en',
  ): Promise<void> {
    const data = await this.repository.findByIdForPdf(contractId);
    if (!data) return;

    const acceptUrl = `${process.env.FRONTEND_URL ?? ''}/contracts/accept/${token}`;
    await this.emailQueue.sendEmail({
      to: data.tenant.email,
      subject:
        lang === 'fr'
          ? 'Votre contrat est prêt pour signature'
          : 'Your lease agreement is ready to sign',
      template: 'contract-acceptance-request',
      data: { message: acceptUrl, acceptUrl },
    });
  }

  private buildPdfVm(
    contractId: string,
    data: Awaited<ReturnType<ContractRepository['findByIdForPdf']>>,
    lang: 'fr' | 'en',
  ): ContractPdfVm {
    if (!data) throw new NotFoundException('Contrat introuvable.');
    return {
      contractId,
      lang,
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
      tvaRate: data.tvaRate,
      tvaAmount: data.tvaAmount,
      rentTTC: data.rent + data.tvaAmount,
      fees: data.fees,
      deposit: data.deposit,
      clauses: data.clauses.map((cl) => cl.text),
    };
  }

  private generatePdfWithTimeout<T>(fn: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new ServiceUnavailableException({
            error: 'PDF_GENERATION_TIMEOUT',
            message:
              'La génération du PDF a pris trop de temps. Veuillez réessayer.',
          }),
        );
      }, PDF_GENERATION_TIMEOUT_MS);
    });

    return Promise.race([fn(), timeout]).finally(() => clearTimeout(timer));
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

  private assertDateRange(start: Date, end: Date): void {
    if (end <= start) {
      throw new BadRequestException({
        error: 'INVALID_DATE_RANGE',
        message: 'La date de fin doit être postérieure à la date de début.',
      });
    }
  }

  private async resolveClauseData(
    templateId: string | undefined,
    clauses: string[] | undefined,
    userId: string,
    role: string,
  ): Promise<{ text: string; order: number }[]> {
    if (clauses && clauses.length > 0) {
      return clauses.map((text, order) => ({ text, order }));
    }
    if (templateId) {
      const template = await this.contractTemplates.getOneScoped(
        templateId,
        userId,
        role,
      );
      const templateClauses =
        (template as never as { clauses: { text: string }[] }).clauses ?? [];
      return templateClauses.map((cl, order) => ({ text: cl.text, order }));
    }
    return [];
  }

  private async checkAccess(
    contract: Contract,
    userId: string,
    role: string,
  ): Promise<void> {
    if (role === Role.ADMIN) return;
    if (role === Role.TENANT) {
      const tenant = await this.repository.findTenantByUserId(userId);
      if (
        !tenant ||
        tenant.id !== (contract as never as { tenantId: string }).tenantId
      ) {
        throw new ForbiddenException({
          error: 'INSUFFICIENT_PERMISSIONS',
          message: 'Droits insuffisants.',
        });
      }
      return;
    }
    const property = await this.repository.findPropertyById(
      (contract as never as { propertyId: string }).propertyId,
    );
    if (
      !property ||
      (property.ownerId !== userId && property.managerId !== userId)
    ) {
      throw new ForbiddenException({
        error: 'INSUFFICIENT_PERMISSIONS',
        message: 'Droits insuffisants.',
      });
    }
  }

  private async buildRoleWhere(
    userId: string,
    role: string,
  ): Promise<Record<string, unknown>> {
    const where: Record<string, unknown> = {};
    if (role === Role.TENANT) {
      const tenant = await this.repository.findTenantByUserId(userId);
      if (tenant) where.tenantId = tenant.id;
      else where.id = 'never';
    } else if (role === Role.MANAGER) {
      where.property = { managerId: userId };
    } else if (role !== Role.ADMIN) {
      where.property = { ownerId: userId };
    }
    return where;
  }
}
