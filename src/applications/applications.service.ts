import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Application, ApplicationStatus, Role } from '@prisma/client';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import type { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import type { ISearchRequest } from '../common/interfaces/search-request.interface';
import { BaseService } from '../common/abstractions/base.service';
import { MandateRepository } from '../mandates/mandate.repository';
import { EmailQueueService } from '../notifications/email-queue.service';
import { NotificationRepository } from '../notifications/notification.repository';
import { PrismaService } from '../prisma/prisma.service';
import { ApplicationCreateData, ApplicationRepository } from './application.repository';

export class SubmitApplicationDto {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  propertyId: string;
  message?: string;
  turnstileToken?: string;
}

@Injectable()
export class ApplicationsService extends BaseService<Application, ApplicationCreateData> {
  constructor(
    protected override readonly repository: ApplicationRepository,
    private readonly prisma: PrismaService,
    private readonly notificationRepo: NotificationRepository,
    private readonly emailQueue: EmailQueueService,
    private readonly mandateRepo: MandateRepository,
  ) {
    super(repository);
  }

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

    const application = await this.repository.create({
      propertyId: dto.propertyId,
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email,
      phone: dto.phone,
      message: dto.message,
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

  async search(user: AuthUser, query: ISearchRequest): Promise<PaginatedResult<Application>> {
    const propertyId = query.filters?.propertyId?.[0];
    if (!propertyId) throw new NotFoundException('PROPERTY_NOT_FOUND');

    await this.authorizeProperty(user, propertyId);
    return this.findWithPagination(query, { propertyId });
  }

  async updateStatus(user: AuthUser, id: string, status: ApplicationStatus) {
    const application = await this.prisma.application.findUnique({
      where: { id },
      select: { id: true, propertyId: true },
    });
    if (!application) throw new NotFoundException('APPLICATION_NOT_FOUND');

    await this.authorizeProperty(user, application.propertyId);
    return this.update(id, { status } as Partial<ApplicationCreateData>);
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
