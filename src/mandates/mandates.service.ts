import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Mandate, MandateStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailQueueService } from '../notifications/email-queue.service';
import { NotificationRepository } from '../notifications/notification.repository';
import { BaseService } from '../common/abstractions/base.service';
import type { CreateMandateDto, TerminateMandateDto } from './dto/mandate.dto';
import { MandateCreateData, MandateRepository } from './mandate.repository';

@Injectable()
export class MandatesService extends BaseService<Mandate, MandateCreateData> {
  private readonly logger = new Logger(MandatesService.name);

  constructor(
    protected override readonly repository: MandateRepository,
    private readonly prisma: PrismaService,
    private readonly notificationRepo: NotificationRepository,
    private readonly emailQueue: EmailQueueService,
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

    const managerEmail = dto.managerEmail.toLowerCase();
    const manager = await this.prisma.user.findUnique({
      where: { email: managerEmail },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
      },
    });
    if (!manager || manager.role !== Role.MANAGER || !manager.isActive) {
      throw new NotFoundException({
        error: 'MANAGER_NOT_FOUND',
        message: 'Aucun gestionnaire trouvé avec cet email',
      });
    }

    const membership = await this.prisma.agencyMember.findFirst({
      where: { userId: manager.id },
      select: { agencyId: true },
    });
    if (!membership) {
      throw new ForbiddenException({
        error: 'MANAGER_NOT_IN_AGENCY',
        message: "Ce gestionnaire n'appartient à aucune agence",
      });
    }

    // Duplicate check + create as a PENDING invitation must be atomic —
    // a TOCTOU race here recurred in story 4.1 (createAgency) after being
    // fixed in story 3.7 (applications.submit); same Serializable pattern.
    // property.managerId is only assigned once the manager accepts (story 4.3),
    // not at invitation time.
    const mandate = await this.prisma.$transaction(
      async (tx) => {
        const duplicate = await tx.mandate.findFirst({
          where: {
            propertyId: dto.propertyId,
            agencyId: membership.agencyId,
            managerId: manager.id,
            status: { in: [MandateStatus.PENDING, MandateStatus.ACTIVE] },
            deletedAt: null,
          },
          select: { id: true },
        });
        if (duplicate) {
          throw new ConflictException({
            error: 'MANDATE_ALREADY_EXISTS',
            message: 'Ce gestionnaire a déjà un mandat actif sur ce bien',
          });
        }

        return tx.mandate.create({
          data: {
            propertyId: dto.propertyId,
            agencyId: membership.agencyId,
            managerId: manager.id,
            status: MandateStatus.PENDING,
            startDate: dto.startDate ? new Date(dto.startDate) : new Date(),
            endDate: dto.endDate ? new Date(dto.endDate) : undefined,
            commissionType: dto.commissionType,
            commissionValue:
              dto.commissionValue !== undefined
                ? dto.commissionValue
                : undefined,
            description: dto.description,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const notifTitle = 'Invitation à gérer un bien';
    const notifBody = `Vous avez été invité à gérer la propriété "${property.title}".`;

    try {
      await Promise.all([
        this.notificationRepo.create({
          userId: manager.id,
          type: 'mandate_invitation',
          title: notifTitle,
          body: notifBody,
        }),
        this.emailQueue.sendEmail({
          to: manager.email,
          subject: notifTitle,
          template: 'mandate-invitation',
          data: {
            managerName: `${manager.firstName} ${manager.lastName}`,
            propertyTitle: property.title,
          },
        }),
      ]);
    } catch (err) {
      this.logger.warn(
        `Manager invitation notification failed for mandate ${mandate.id}: ${err}`,
      );
    }

    return mandate;
  }

  async accept(id: string, userId: string, role: string): Promise<Mandate> {
    const updated = await this.prisma.$transaction(
      async (tx) => {
        const mandate = await tx.mandate.findFirst({
          where: { id, deletedAt: null },
        });
        if (!mandate) throw new NotFoundException('MANDATE_NOT_FOUND');

        if (role !== Role.ADMIN && mandate.managerId !== userId) {
          throw new ForbiddenException('NOT_MANDATE_MANAGER');
        }

        if (mandate.status !== MandateStatus.PENDING) {
          throw new ConflictException({
            error: 'MANDATE_ALREADY_DECIDED',
            message: 'Ce mandat a déjà été traité',
          });
        }

        const result = await tx.mandate.update({
          where: { id },
          data: { status: MandateStatus.ACTIVE },
        });

        await tx.property.update({
          where: { id: mandate.propertyId },
          data: { managerId: mandate.managerId },
        });

        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    await this.notifyOwnerOfDecision(updated, {
      type: 'mandate_accepted',
      template: 'mandate-accepted',
      title: 'Délégation acceptée',
      body: (ownerName, managerName, propertyTitle) =>
        `${managerName} a accepté de gérer votre bien "${propertyTitle}".`,
    });

    return updated;
  }

  async refuse(id: string, userId: string, role: string): Promise<Mandate> {
    const updated = await this.prisma.$transaction(
      async (tx) => {
        const mandate = await tx.mandate.findFirst({
          where: { id, deletedAt: null },
        });
        if (!mandate) throw new NotFoundException('MANDATE_NOT_FOUND');

        if (role !== Role.ADMIN && mandate.managerId !== userId) {
          throw new ForbiddenException('NOT_MANDATE_MANAGER');
        }

        if (mandate.status !== MandateStatus.PENDING) {
          throw new ConflictException({
            error: 'MANDATE_ALREADY_DECIDED',
            message: 'Ce mandat a déjà été traité',
          });
        }

        // Unlike accept(), never touch property.managerId — this mandate was
        // never active, so the property never had it assigned.
        return tx.mandate.update({
          where: { id },
          data: { status: MandateStatus.REFUSED },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    await this.notifyOwnerOfDecision(updated, {
      type: 'mandate_refused',
      template: 'mandate-refused',
      title: 'Votre demande de délégation a été refusée',
      body: () => 'Votre demande de délégation a été refusée',
    });

    return updated;
  }

  /** Best-effort, non-blocking owner notification for accept()/refuse(). */
  private async notifyOwnerOfDecision(
    mandate: Mandate,
    config: {
      type: string;
      template: string;
      title: string;
      body: (
        ownerName: string,
        managerName: string,
        propertyTitle: string,
      ) => string;
    },
  ): Promise<void> {
    const [property, manager] = await Promise.all([
      this.prisma.property.findUnique({
        where: { id: mandate.propertyId },
        select: { title: true, ownerId: true },
      }),
      this.prisma.user.findUnique({
        where: { id: mandate.managerId },
        select: { firstName: true, lastName: true },
      }),
    ]);
    if (!property || !manager) return;

    const owner = await this.prisma.user.findUnique({
      where: { id: property.ownerId },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
    if (!owner) return;

    const managerName = `${manager.firstName} ${manager.lastName}`;
    const ownerName = `${owner.firstName} ${owner.lastName}`;
    const notifBody = config.body(ownerName, managerName, property.title);

    try {
      await Promise.all([
        this.notificationRepo.create({
          userId: owner.id,
          type: config.type,
          title: config.title,
          body: notifBody,
        }),
        this.emailQueue.sendEmail({
          to: owner.email,
          subject: config.title,
          template: config.template,
          data: { ownerName, managerName, propertyTitle: property.title },
        }),
      ]);
    } catch (err) {
      this.logger.warn(
        `Owner notification failed for mandate ${mandate.id} decision: ${err}`,
      );
    }
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

    if (mandate.status === MandateStatus.PENDING) {
      throw new ConflictException({
        error: 'MANDATE_NOT_ACTIVE',
        message: "Ce mandat n'a pas encore été accepté par le gestionnaire",
      });
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
