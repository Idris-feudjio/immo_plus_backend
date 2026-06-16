import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Commission, CommissionStatus, Role } from '@prisma/client';
import type { SearchRequest } from '../common/interfaces/search-request.interface';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { PdfService } from '../common/services/pdf.service';
import { CacheService } from '../cache/cache.service';
import { NotificationRepository } from '../notifications/notification.repository';
import { EmailQueueService } from '../notifications/email-queue.service';
import { MandateRepository } from '../mandates/mandate.repository';
import { BaseService } from '../common/abstractions/base.service';
import type { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import type { CreateCommissionDto, PayCommissionDto } from './dto/commission.dto';
import { CommissionCreateData, CommissionRepository } from './commission.repository';

type WithRelations = Commission & {
  mandate?: {
    id: string;
    managerId: string;
    manager?: { id: string; email: string; firstName: string; lastName: string };
  } | null;
  agency?: { id: string; name: string; address?: string | null };
  contract?: {
    id: string;
    propertyId: string;
    property?: {
      id: string;
      title: string;
      address: string;
      city: string;
      ownerId: string;
      owner?: { id: string; email: string; firstName: string; lastName: string };
    };
  };
};

@Injectable()
export class CommissionsService extends BaseService<Commission, CommissionCreateData> {
  constructor(
    protected override readonly repository: CommissionRepository,
    private readonly prisma: PrismaService,
    private readonly notificationRepo: NotificationRepository,
    private readonly emailQueue: EmailQueueService,
    private readonly storage: StorageService,
    private readonly pdf: PdfService,
    private readonly cache: CacheService,
    private readonly mandateRepo: MandateRepository,
  ) {
    super(repository);
  }

  // Story 8.2: Manual commission creation (PLACEMENT or EXCEPTIONAL)
  async createCommission(userId: string, role: string, dto: CreateCommissionDto): Promise<Commission> {
    const contract = await this.prisma.contract.findUnique({
      where: { id: dto.contractId },
      select: {
        id: true,
        propertyId: true,
        property: {
          select: {
            id: true,
            title: true,
            ownerId: true,
            owner: { select: { id: true, email: true, firstName: true, lastName: true } },
          },
        },
      },
    });
    if (!contract) throw new NotFoundException('CONTRACT_NOT_FOUND');

    let agencyId: string;
    let mandateId: string | undefined;

    if (role === Role.MANAGER) {
      if (dto.mandateId) {
        const mandate = await this.prisma.mandate.findFirst({
          where: { id: dto.mandateId, managerId: userId, status: 'ACTIVE', deletedAt: null },
          select: { id: true, agencyId: true },
        });
        if (!mandate) throw new ForbiddenException('NO_ACTIVE_MANDATE');
        agencyId = mandate.agencyId;
        mandateId = mandate.id;
      } else {
        const ref = await this.mandateRepo.findActiveByManager(userId, contract.propertyId);
        if (!ref) throw new ForbiddenException('NO_ACTIVE_MANDATE');
        const mandate = await this.prisma.mandate.findUnique({
          where: { id: ref.id },
          select: { id: true, agencyId: true },
        });
        if (!mandate) throw new ForbiddenException('NO_ACTIVE_MANDATE');
        agencyId = mandate.agencyId;
        mandateId = mandate.id;
      }
    } else if (role === Role.ADMIN) {
      if (dto.mandateId) {
        const mandate = await this.prisma.mandate.findUnique({
          where: { id: dto.mandateId },
          select: { id: true, agencyId: true },
        });
        if (!mandate) throw new NotFoundException('MANDATE_NOT_FOUND');
        agencyId = mandate.agencyId;
        mandateId = mandate.id;
      } else if (dto.agencyId) {
        agencyId = dto.agencyId;
      } else {
        throw new ForbiddenException('AGENCY_REQUIRED');
      }
    } else {
      throw new ForbiddenException('INSUFFICIENT_ROLE');
    }

    const tvaAmount = Math.round(dto.amountHT * 19.25 / 100);
    const amountTTC = dto.amountHT + tvaAmount;

    const commission = await this.repository.create({
      contractId: dto.contractId,
      agencyId,
      mandateId,
      type: dto.type,
      amountHT: dto.amountHT,
      tvaRate: 19.25,
      tvaAmount,
      amountTTC,
      description: dto.description,
      status: CommissionStatus.PENDING,
    });

    const owner = (contract.property as { owner?: { id: string; email: string; firstName: string; lastName: string } })?.owner;
    if (owner) {
      await this.notificationRepo.create({
        userId: owner.id,
        type: 'commission_generated',
        title: 'Nouvelle commission',
        body: `Une commission de ${amountTTC} FCFA TTC a été créée pour "${contract.property?.title}".`,
      });
      await this.emailQueue.sendEmail({
        to: owner.email,
        subject: 'Nouvelle commission',
        template: 'commission-generated',
        data: {
          ownerName: owner.firstName,
          amount: amountTTC,
          propertyTitle: contract.property?.title ?? '',
        },
      });
    }

    return commission;
  }

  // Story 8.3: Mark commission paid, generate PDF receipt
  async pay(id: string, userId: string, role: string, dto: PayCommissionDto): Promise<Commission> {
    const commission = (await this.repository.findById(id)) as WithRelations | null;
    if (!commission) throw new NotFoundException('COMMISSION_NOT_FOUND');

    const property = commission.contract?.property;

    if (role !== Role.ADMIN && property?.ownerId !== userId) {
      throw new ForbiddenException('NOT_PROPERTY_OWNER');
    }
    if (commission.status !== CommissionStatus.PENDING) {
      throw new ConflictException('COMMISSION_ALREADY_PROCESSED');
    }

    const pdfBuffer = await this.pdf.generateCommissionReceiptPdf({
      commissionId: commission.id,
      agencyName: commission.agency?.name ?? '',
      agencyAddress: commission.agency?.address ?? undefined,
      ownerFirstName: property?.owner?.firstName ?? '',
      ownerLastName: property?.owner?.lastName ?? '',
      propertyTitle: property?.title ?? '',
      propertyAddress: property?.address ?? undefined,
      type: commission.type,
      description: commission.description ?? undefined,
      amountHT: commission.amountHT,
      tvaRate: Number(commission.tvaRate),
      tvaAmount: commission.tvaAmount,
      amountTTC: commission.amountTTC,
      paymentDate: new Date(),
      paymentMethod: dto.paymentMethod,
      reference: dto.reference,
    });

    const key = `commissions/${commission.id}/receipt.pdf`;
    const receiptUrl = await this.storage.uploadBuffer(key, pdfBuffer, 'application/pdf');

    const updated = await this.repository.update(id, {
      status: CommissionStatus.PAID,
      paidAt: new Date(),
      paymentMethod: dto.paymentMethod as never,
      reference: dto.reference,
      receiptUrl,
    });

    const manager = commission.mandate?.manager;
    if (manager) {
      await this.notificationRepo.create({
        userId: manager.id,
        type: 'commission_paid',
        title: 'Commission réglée',
        body: `Votre commission de ${commission.amountTTC} FCFA TTC a été réglée.`,
        link: receiptUrl,
      });
      await this.emailQueue.sendEmail({
        to: manager.email,
        subject: 'Commission réglée',
        template: 'commission-paid',
        data: {
          managerName: manager.firstName,
          amount: commission.amountTTC,
          receiptUrl,
        },
      });
    }

    return updated;
  }

  // Story 8.4: Cancel a PENDING commission
  async cancel(id: string, userId: string, role: string): Promise<Commission> {
    const commission = (await this.repository.findById(id)) as WithRelations | null;
    if (!commission) throw new NotFoundException('COMMISSION_NOT_FOUND');

    const property = commission.contract?.property;

    if (role !== Role.ADMIN && property?.ownerId !== userId) {
      throw new ForbiddenException('NOT_PROPERTY_OWNER');
    }
    if (commission.status !== CommissionStatus.PENDING) {
      throw new ConflictException('COMMISSION_NOT_CANCELLABLE');
    }

    return this.repository.update(id, { status: CommissionStatus.CANCELLED });
  }

  // Story 8.5: Paginated search (MANAGER → own agency, ADMIN → all)
  async search(userId: string, role: string, query: SearchRequest): Promise<PaginatedResult<Commission>> {
    const baseWhere: Record<string, unknown> = {};
    if (role === Role.MANAGER) {
      const memberships = await this.prisma.agencyMember.findMany({
        where: { userId },
        select: { agencyId: true },
      });
      baseWhere.agencyId = { in: memberships.map((m) => m.agencyId) };
    }
    return this.findWithPagination(query, baseWhere);
  }

  // Story 8.5: Dashboard with Redis cache (TTL 5min)
  async getDashboard(userId: string, role: string): Promise<unknown> {
    let agencyId: string | null = null;
    if (role === Role.MANAGER) {
      const membership = await this.prisma.agencyMember.findFirst({
        where: { userId },
        select: { agencyId: true },
      });
      if (!membership) return { byStatus: [], byType: [] };
      agencyId = membership.agencyId;
    }

    const cacheKey = `commissions:${agencyId ?? 'all'}:dashboard`;
    const cached = await this.cache.get<Record<string, unknown>>(cacheKey);
    if (cached) return cached;

    const stats = await this.repository.getDashboardStats(agencyId);
    await this.cache.set(cacheKey, stats, 300);
    return stats;
  }

  // Story 8.6: Owner view — commissions on own properties, grouped by agency
  async getMyDue(userId: string): Promise<unknown> {
    const commissions = (await this.repository.getOwnerDue(userId)) as WithRelations[];

    const groups: Record<string, {
      agencyId: string;
      agencyName: string;
      pendingCount: number;
      pendingAmountTTC: number;
      paidCount: number;
      paidAmountTTC: number;
      commissions: Commission[];
    }> = {};

    for (const c of commissions) {
      const key = c.agencyId;
      if (!groups[key]) {
        groups[key] = {
          agencyId: c.agencyId,
          agencyName: c.agency?.name ?? c.agencyId,
          pendingCount: 0,
          pendingAmountTTC: 0,
          paidCount: 0,
          paidAmountTTC: 0,
          commissions: [],
        };
      }
      const g = groups[key];
      if (c.status === CommissionStatus.PENDING) {
        g.pendingCount++;
        g.pendingAmountTTC += c.amountTTC;
      } else if (c.status === CommissionStatus.PAID) {
        g.paidCount++;
        g.paidAmountTTC += c.amountTTC;
      }
      g.commissions.push(c);
    }

    return { data: Object.values(groups) };
  }
}
