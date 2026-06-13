import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Mandate, MandateStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationRepository } from '../notifications/notification.repository';
import type { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import type { CreateMandateDto, ListMandatesDto, TerminateMandateDto } from './dto/mandate.dto';
import type { IMandateService } from './interfaces/mandate-service.interface';
import { MandateRepository } from './mandate.repository';

@Injectable()
export class MandatesService implements IMandateService {
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
    return this.repository.findListPaginated(userId, role, query);
  }
}
