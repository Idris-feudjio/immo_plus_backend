import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApplicationStatus, Prisma, Role } from '@prisma/client';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { MandateRepository } from '../mandates/mandate.repository';
import { EmailQueueService } from '../notifications/email-queue.service';
import { NotificationRepository } from '../notifications/notification.repository';
import { PrismaService } from '../prisma/prisma.service';

export class SubmitApplicationDto {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  propertyId: string;
  message?: string;
  turnstileToken?: string;
}

export class ListApplicationsQuery {
  propertyId: string;
  status?: ApplicationStatus;
  page?: number;
  limit?: number;
}

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationRepo: NotificationRepository,
    private readonly emailQueue: EmailQueueService,
    private readonly mandateRepo: MandateRepository,
  ) {}

  async submit(dto: SubmitApplicationDto) {
    const property = await this.prisma.property.findFirst({
      where: { id: dto.propertyId, isPublished: true, deletedAt: null },
      select: {
        id: true,
        title: true,
        city: true,
        owner: { select: { id: true, email: true, firstName: true, lastName: true } },
        manager: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });
    if (!property) throw new NotFoundException('PROPERTY_NOT_FOUND');

    const application = await this.prisma.application.create({
      data: {
        propertyId: dto.propertyId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        phone: dto.phone,
        message: dto.message,
      },
      select: { id: true, status: true },
    });

    const recipients = [property.owner, ...(property.manager ? [property.manager] : [])];
    const notifTitle = `Nouvelle candidature — ${property.title}`;
    const notifBody = `${dto.firstName} ${dto.lastName} a soumis une candidature pour ${property.title} (${property.city}).`;

    await Promise.all(
      recipients.flatMap((r) => [
        this.notificationRepo.create({
          userId: r.id,
          type: 'NEW_APPLICATION',
          title: notifTitle,
          body: notifBody,
        }),
        this.emailQueue.sendEmail({
          to: r.email,
          subject: notifTitle,
          template: 'new-application',
          data: {
            recipientName: `${r.firstName} ${r.lastName}`,
            applicantName: `${dto.firstName} ${dto.lastName}`,
            applicantEmail: dto.email,
            applicantPhone: dto.phone ?? '',
            propertyTitle: property.title,
            message: dto.message ?? '',
          },
        }),
      ]),
    );

    return { applicationId: application.id, status: application.status };
  }

  async listForProperty(user: AuthUser, query: ListApplicationsQuery) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));

    await this.authorizeProperty(user, query.propertyId);

    const where: Prisma.ApplicationWhereInput = { propertyId: query.propertyId };
    if (query.status) where.status = query.status;

    const [data, total] = await Promise.all([
      this.prisma.application.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.application.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async updateStatus(user: AuthUser, id: string, status: ApplicationStatus) {
    const application = await this.prisma.application.findUnique({
      where: { id },
      select: { id: true, propertyId: true },
    });
    if (!application) throw new NotFoundException('APPLICATION_NOT_FOUND');

    await this.authorizeProperty(user, application.propertyId);

    return this.prisma.application.update({ where: { id }, data: { status } });
  }

  private async authorizeProperty(user: AuthUser, propertyId: string) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, deletedAt: null },
      select: { id: true, ownerId: true },
    });
    if (!property) throw new NotFoundException('PROPERTY_NOT_FOUND');

    if (user.role === Role.OWNER && property.ownerId !== user.id) {
      throw new ForbiddenException('NOT_PROPERTY_OWNER');
    }
    if (user.role === Role.MANAGER) {
      const mandate = await this.mandateRepo.findActiveByManager(user.id, propertyId);
      if (!mandate) throw new ForbiddenException('NO_ACTIVE_MANDATE');
    }

    return property;
  }
}
