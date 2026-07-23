import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ContractStatus,
  MaintenanceRequest,
  MaintenanceStatus,
  MaintenanceUrgency,
  Role,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import type { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import type { ISearchRequest } from '../common/interfaces/search-request.interface';
import { BaseService } from '../common/abstractions/base.service';
import { EmailQueueService } from '../notifications/email-queue.service';
import { NotificationRepository } from '../notifications/notification.repository';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type {
  CreateMaintenanceDto,
  UpdateMaintenanceStatusDto,
} from './dto/maintenance.dto';
import {
  MaintenanceCreateData,
  MaintenanceRepository,
} from './maintenance.repository';

@Injectable()
export class MaintenanceService extends BaseService<
  MaintenanceRequest,
  MaintenanceCreateData
> {
  constructor(
    protected override readonly repository: MaintenanceRepository,
    private readonly prisma: PrismaService,
    private readonly notificationRepo: NotificationRepository,
    private readonly emailQueue: EmailQueueService,
    private readonly storage: StorageService,
  ) {
    super(repository);
  }

  // ── Story 6.1: Create maintenance request ────────────────────────────────────

  async createRequest(
    user: AuthUser,
    dto: CreateMaintenanceDto,
  ): Promise<MaintenanceRequest> {
    const property = await this.prisma.property.findFirst({
      where: { id: dto.propertyId, deletedAt: null },
      select: {
        id: true,
        title: true,
        ownerId: true,
        owner: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
      },
    });
    if (!property) throw new NotFoundException('PROPERTY_NOT_FOUND');

    let tenantId: string | undefined;

    if (user.role === Role.TENANT) {
      const tenant = await this.prisma.tenant.findFirst({
        where: { userId: user.id },
      });
      if (!tenant) throw new ForbiddenException('TENANT_NOT_FOUND');

      const contract = await this.prisma.contract.findFirst({
        where: {
          propertyId: dto.propertyId,
          tenantId: tenant.id,
          status: ContractStatus.ACTIVE,
        },
        select: { id: true },
      });
      if (!contract) throw new ForbiddenException('NO_ACTIVE_CONTRACT');

      tenantId = tenant.id;
    } else if (user.role === Role.OWNER) {
      if (property.ownerId !== user.id)
        throw new ForbiddenException('NOT_PROPERTY_OWNER');
    } else if (user.role === Role.MANAGER) {
      const mandates = await this.repository.findManagedPropertyIds(user.id);
      if (!mandates.some((m) => m.propertyId === dto.propertyId)) {
        throw new ForbiddenException('NO_ACTIVE_MANDATE');
      }
    }

    const request = await this.repository.create({
      propertyId: dto.propertyId,
      tenantId,
      title: dto.title,
      description: dto.description,
      urgency: dto.urgency ?? MaintenanceUrgency.NORMAL,
      images: dto.images ?? [],
    });

    const isCritical = request.urgency === MaintenanceUrgency.CRITICAL;
    const notifTitle = isCritical
      ? `[CRITIQUE] Demande maintenance — ${property.title}`
      : `Nouvelle demande maintenance — ${property.title}`;
    const notifBody = `"${dto.title}": ${dto.description}`;

    await Promise.all([
      this.notificationRepo.create({
        userId: property.owner.id,
        type: isCritical ? 'maintenance_critical' : 'maintenance_created',
        title: notifTitle,
        body: notifBody,
      }),
      this.emailQueue.sendEmail({
        to: property.owner.email,
        subject: notifTitle,
        template: 'maintenance-created',
        data: {
          ownerName: `${property.owner.firstName} ${property.owner.lastName}`,
          propertyTitle: property.title,
          requestTitle: dto.title,
          description: dto.description,
          urgency: request.urgency,
          isCritical,
        },
      }),
    ]);

    return request;
  }

  // ── Story 6.2: Update status ──────────────────────────────────────────────────

  async updateStatus(
    user: AuthUser,
    id: string,
    dto: UpdateMaintenanceStatusDto,
  ): Promise<MaintenanceRequest> {
    const existing = await this.prisma.maintenanceRequest.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        tenantId: true,
        propertyId: true,
        title: true,
        property: { select: { ownerId: true, title: true } },
      },
    });
    if (!existing) throw new NotFoundException('MAINTENANCE_NOT_FOUND');

    const ownerManagerStatuses: MaintenanceStatus[] = [
      MaintenanceStatus.IN_PROGRESS,
      MaintenanceStatus.RESOLVED,
    ];
    const tenantStatuses: MaintenanceStatus[] = [
      MaintenanceStatus.CLOSED,
      MaintenanceStatus.OPEN,
    ];

    if (ownerManagerStatuses.includes(dto.status)) {
      if (user.role === Role.TENANT)
        throw new ForbiddenException('TENANT_CANNOT_SET_STATUS');

      if (user.role === Role.OWNER && existing.property.ownerId !== user.id) {
        throw new ForbiddenException('NOT_PROPERTY_OWNER');
      }
      if (user.role === Role.MANAGER) {
        const mandates = await this.repository.findManagedPropertyIds(user.id);
        if (!mandates.some((m) => m.propertyId === existing.propertyId)) {
          throw new ForbiddenException('NO_ACTIVE_MANDATE');
        }
      }

      if (
        dto.status === MaintenanceStatus.IN_PROGRESS &&
        existing.status !== MaintenanceStatus.OPEN
      ) {
        throw new BadRequestException('INVALID_TRANSITION');
      }
      if (
        dto.status === MaintenanceStatus.RESOLVED &&
        existing.status !== MaintenanceStatus.IN_PROGRESS
      ) {
        throw new BadRequestException('INVALID_TRANSITION');
      }
    } else if (tenantStatuses.includes(dto.status)) {
      if (user.role !== Role.TENANT && user.role !== Role.ADMIN) {
        throw new ForbiddenException('ONLY_TENANT_CAN_SET_STATUS');
      }
      if (user.role === Role.TENANT) {
        const tenant = await this.prisma.tenant.findFirst({
          where: { userId: user.id },
        });
        if (!tenant || existing.tenantId !== tenant.id) {
          throw new ForbiddenException('NOT_REQUEST_CREATOR');
        }
      }
      if (existing.status !== MaintenanceStatus.RESOLVED) {
        throw new BadRequestException('INVALID_TRANSITION');
      }
    } else {
      throw new BadRequestException('INVALID_STATUS');
    }

    const updated = await this.prisma.maintenanceRequest.update({
      where: { id },
      data: {
        status: dto.status,
        ...(dto.comment !== undefined ? { comment: dto.comment } : {}),
      },
    });

    if (existing.tenantId) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: existing.tenantId },
        select: { userId: true, email: true, firstName: true, lastName: true },
      });
      if (tenant) {
        const notifTitle = `Mise à jour maintenance — ${existing.property.title}`;
        const notifBody = `Le statut de "${existing.title}" est maintenant ${dto.status}.`;

        const notifJobs: Promise<unknown>[] = [
          this.emailQueue.sendEmail({
            to: tenant.email,
            subject: notifTitle,
            template: 'maintenance-status-updated',
            data: {
              tenantName: `${tenant.firstName} ${tenant.lastName}`,
              propertyTitle: existing.property.title,
              requestTitle: existing.title,
              newStatus: dto.status,
              comment: dto.comment,
            },
          }),
        ];
        if (tenant.userId) {
          notifJobs.push(
            this.notificationRepo.create({
              userId: tenant.userId,
              type: 'maintenance_status_updated',
              title: notifTitle,
              body: notifBody,
            }),
          );
        }
        await Promise.all(notifJobs);
      }
    }

    return updated;
  }

  // ── Story 6.3: List maintenance requests ─────────────────────────────────────

  async search(
    user: AuthUser,
    query: ISearchRequest,
  ): Promise<PaginatedResult<MaintenanceRequest>> {
    let baseWhere: Record<string, unknown> = {};

    if (user.role === Role.OWNER) {
      baseWhere = { property: { ownerId: user.id } };
    } else if (user.role === Role.MANAGER) {
      const mandates = await this.repository.findManagedPropertyIds(user.id);
      baseWhere = { propertyId: { in: mandates.map((m) => m.propertyId) } };
    }

    return this.findWithPagination(query, baseWhere);
  }

  // ── Story 6.4: Tenant self-service view ──────────────────────────────────────

  async getMyRequests(userId: string): Promise<{ data: unknown[] }> {
    const tenant = await this.prisma.tenant.findFirst({ where: { userId } });
    if (!tenant) throw new NotFoundException('TENANT_NOT_FOUND');

    const data = await this.prisma.maintenanceRequest.findMany({
      where: { tenantId: tenant.id },
      select: {
        id: true,
        title: true,
        status: true,
        urgency: true,
        comment: true,
        images: true,
        createdAt: true,
        updatedAt: true,
        property: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return { data };
  }

  // ── Story 6.5: Photo upload ───────────────────────────────────────────────────

  async addPhotos(
    user: AuthUser,
    id: string,
    files: Express.Multer.File[],
  ): Promise<{ images: string[] }> {
    const existing = await this.prisma.maintenanceRequest.findUnique({
      where: { id },
      select: {
        id: true,
        tenantId: true,
        images: true,
        property: { select: { ownerId: true } },
      },
    });
    if (!existing) throw new NotFoundException('MAINTENANCE_NOT_FOUND');

    if (user.role === Role.TENANT) {
      const tenant = await this.prisma.tenant.findFirst({
        where: { userId: user.id },
      });
      if (!tenant || existing.tenantId !== tenant.id) {
        throw new ForbiddenException('NOT_REQUEST_CREATOR');
      }
    } else if (user.role === Role.OWNER) {
      if (existing.property.ownerId !== user.id)
        throw new ForbiddenException('NOT_PROPERTY_OWNER');
    }

    if (!files || files.length === 0) throw new BadRequestException('NO_FILES');
    if (files.length > 3) throw new BadRequestException('TOO_MANY_FILES');

    const uploadedUrls = await Promise.all(
      files.map(async (file) => {
        const extMatch = file.originalname.match(/\.(\w+)$/);
        const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
        const photoId = randomUUID();
        const key = `maintenance/${id}/photos/${photoId}.${ext}`;
        return this.storage.uploadBuffer(key, file.buffer, file.mimetype);
      }),
    );

    const updated = await this.prisma.maintenanceRequest.update({
      where: { id },
      data: { images: { push: uploadedUrls } },
      select: { images: true },
    });

    return { images: updated.images };
  }
}
