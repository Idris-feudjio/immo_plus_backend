import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Mandate, MandateStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationRepository } from '../notifications/notification.repository';
import { BaseService } from '../common/abstractions/base.service';
import type { CreateMandateDto, TerminateMandateDto } from './dto/mandate.dto';
import { MandateCreateData, MandateRepository } from './mandate.repository';

@Injectable()
export class MandatesService extends BaseService<Mandate, MandateCreateData> {
  constructor(
    protected override readonly repository: MandateRepository,
    private readonly prisma: PrismaService,
    private readonly notificationRepo: NotificationRepository,
  ) {
    super(repository);
  }

  async createMandate(
    userId: string,
    role: string,
    dto: CreateMandateDto,
  ): Promise<Mandate> {
    const property = await this.prisma.property.findUnique({
      where: { id: dto.propertyId },
      select: { id: true, ownerId: true, title: true },
    });
    if (!property) throw new NotFoundException('PROPERTY_NOT_FOUND');

    if (role !== Role.ADMIN && property.ownerId !== userId) {
      throw new ForbiddenException('NOT_PROPERTY_OWNER');
    }

    const membership = await this.prisma.agencyMember.findFirst({
      where: { agencyId: dto.agencyId, userId: dto.managerId },
      select: { id: true },
    });
    if (!membership) throw new ForbiddenException('MANAGER_NOT_IN_AGENCY');

    const duplicate = await this.repository.findDuplicate(
      dto.propertyId,
      dto.agencyId,
      dto.managerId,
    );
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
      commissionValue:
        dto.commissionValue !== undefined ? dto.commissionValue : undefined,
      description: dto.description,
    });

    await this.prisma.property.update({
      where: { id: dto.propertyId },
      data: { managerId: dto.managerId },
    });

    await this.notificationRepo.create({
      userId: dto.managerId,
      type: 'mandate_assigned',
      title: 'Nouveau mandat assigné',
      body: `Un mandat de gestion pour la propriété "${property.title}" vous a été assigné.`,
    });

    return mandate;
  }

  async terminate(
    id: string,
    userId: string,
    role: string,
    _dto: TerminateMandateDto,
  ): Promise<Mandate> {
    const mandate = await this.repository.findById(id);
    if (!mandate) throw new NotFoundException('MANDATE_NOT_FOUND');

    const property = await this.prisma.property.findUnique({
      where: { id: mandate.propertyId },
      select: { ownerId: true, title: true },
    });

    if (role !== Role.ADMIN && property?.ownerId !== userId) {
      throw new ForbiddenException('NOT_PROPERTY_OWNER');
    }

    if (
      mandate.status === MandateStatus.TERMINATED ||
      mandate.status === MandateStatus.EXPIRED
    ) {
      throw new ConflictException('MANDATE_ALREADY_CLOSED');
    }

    const updated = await this.repository.updateStatus(
      id,
      MandateStatus.TERMINATED,
    );

    await this.prisma.property.updateMany({
      where: { id: mandate.propertyId, managerId: mandate.managerId },
      data: { managerId: null },
    });

    await this.notificationRepo.create({
      userId: mandate.managerId,
      type: 'mandate_terminated',
      title: 'Mandat résilié',
      body: `Le mandat de gestion pour la propriété "${property?.title ?? mandate.propertyId}" a été résilié.`,
    });

    return updated;
  }
}
