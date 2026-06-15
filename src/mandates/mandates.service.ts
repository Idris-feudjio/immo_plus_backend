import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Mandate, MandateStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationRepository } from '../notifications/notification.repository';
import type { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import type { CreateMandateDto, ListMandatesDto, TerminateMandateDto } from './dto/mandate.dto';
import { MandateRepository } from './mandate.repository';

@Injectable()
export class MandatesService {
  constructor(
    private readonly repository: MandateRepository,
    private readonly prisma: PrismaService,
    private readonly notificationRepo: NotificationRepository,
  ) {}

  async create(userId: string, role: string, dto: CreateMandateDto): Promise<Mandate> {
    // Check property exists and caller is OWNER or ADMIN
    const property = await this.prisma.property.findUnique({
      where: { id: dto.propertyId },
      select: { id: true, ownerId: true, title: true },
    });
    if (!property) throw new NotFoundException('PROPERTY_NOT_FOUND');

    if (role !== Role.ADMIN && property.ownerId !== userId) {
      throw new ForbiddenException('NOT_PROPERTY_OWNER');
    }

    // Validate manager is an AgencyMember of the given agency
    const membership = await this.prisma.agencyMember.findFirst({
      where: { agencyId: dto.agencyId, userId: dto.managerId },
      select: { id: true },
    });
    if (!membership) throw new ForbiddenException('MANAGER_NOT_IN_AGENCY');

    // Check no active duplicate mandate
    const duplicate = await this.repository.findDuplicate(dto.propertyId, dto.agencyId, dto.managerId);
    if (duplicate) throw new ConflictException('MANDATE_ALREADY_EXISTS');

    // Create mandate
    const mandate = await this.repository.create({
      propertyId: dto.propertyId,
      agencyId: dto.agencyId,
      managerId: dto.managerId,
      status: MandateStatus.ACTIVE,
      startDate: new Date(dto.startDate),
      endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      commissionType: dto.commissionType,
      commissionValue: dto.commissionValue !== undefined ? dto.commissionValue : undefined,
      description: dto.description,
    });

    // Sync Property.managerId so contract/payment guards recognize the manager
    await this.prisma.property.update({
      where: { id: dto.propertyId },
      data: { managerId: dto.managerId },
    });

    // Notify manager
    await this.notificationRepo.create({
      userId: dto.managerId,
      type: 'mandate_assigned',
      title: 'Nouveau mandat assigné',
      body: `Un mandat de gestion pour la propriété "${property.title}" vous a été assigné.`,
    });

    return mandate;
  }

  async terminate(id: string, userId: string, role: string, _dto: TerminateMandateDto): Promise<Mandate> {
    const mandate = await this.repository.findById(id);
    if (!mandate) throw new NotFoundException('MANDATE_NOT_FOUND');

    // Auth: OWNER of mandate's property or ADMIN
    const property = await this.prisma.property.findUnique({
      where: { id: mandate.propertyId },
      select: { ownerId: true, title: true },
    });

    if (role !== Role.ADMIN && property?.ownerId !== userId) {
      throw new ForbiddenException('NOT_PROPERTY_OWNER');
    }

    // Must be in ACTIVE status
    if (mandate.status === MandateStatus.TERMINATED || mandate.status === MandateStatus.EXPIRED) {
      throw new ConflictException('MANDATE_ALREADY_CLOSED');
    }

    const updated = await this.repository.updateStatus(id, MandateStatus.TERMINATED);

    // Clear Property.managerId only if it still points to this mandate's manager
    await this.prisma.property.updateMany({
      where: { id: mandate.propertyId, managerId: mandate.managerId },
      data: { managerId: null },
    });

    // Notify manager
    await this.notificationRepo.create({
      userId: mandate.managerId,
      type: 'mandate_terminated',
      title: 'Mandat résilié',
      body: `Le mandat de gestion pour la propriété "${property?.title ?? mandate.propertyId}" a été résilié.`,
    });

    return updated;
  }

  list(userId: string, role: string, query: ListMandatesDto): Promise<PaginatedResult<Mandate>> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 10));
    const where: Prisma.MandateWhereInput = { deletedAt: null };
    if (role === Role.OWNER) where.property = { ownerId: userId };
    else if (role === Role.MANAGER) where.managerId = userId;
    if (query.status) where.status = query.status;
    if (query.propertyId) where.propertyId = query.propertyId;
    if (query.agencyId) where.agencyId = query.agencyId;
    return this.repository.findPaginated(where, page, limit);
  }
}
