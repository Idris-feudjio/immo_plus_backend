import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Application, ApplicationStatus, Prisma, Role } from '@prisma/client';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import type { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import type { ISearchRequest } from '../common/interfaces/search-request.interface';
import { BaseService } from '../common/abstractions/base.service';
import { MandateRepository } from '../mandates/mandate.repository';
import { EmailQueueService } from '../notifications/email-queue.service';
import { NotificationRepository } from '../notifications/notification.repository';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  ApplicationCreateData,
  ApplicationRepository,
} from './application.repository';
import { SubmitApplicationDto } from './dto/application.dto';

const MAX_ATTACHMENTS = 5;

@Injectable()
export class ApplicationsService extends BaseService<
  Application,
  ApplicationCreateData
> {
  private readonly logger = new Logger(ApplicationsService.name);

  constructor(
    protected override readonly repository: ApplicationRepository,
    private readonly prisma: PrismaService,
    private readonly notificationRepo: NotificationRepository,
    private readonly emailQueue: EmailQueueService,
    private readonly mandateRepo: MandateRepository,
    private readonly storage: StorageService,
  ) {
    super(repository);
  }

  async submit(user: AuthUser, dto: SubmitApplicationDto) {
    const property = await this.prisma.property.findFirst({
      where: { id: dto.propertyId, isPublished: true, deletedAt: null },
      select: {
        id: true,
        title: true,
        city: true,
        owner: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
        manager: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
      },
    });
    if (!property) throw new NotFoundException('PROPERTY_NOT_FOUND');

    const application = await this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.application.findFirst({
          where: {
            userId: user.id,
            propertyId: dto.propertyId,
            status: {
              in: [ApplicationStatus.PENDING, ApplicationStatus.ACCEPTED],
            },
          },
          select: { id: true },
        });
        if (existing) {
          throw new ConflictException({
            error: 'DUPLICATE_APPLICATION',
            message: 'Vous avez déjà un dossier en cours pour ce bien',
          });
        }

        return tx.application.create({
          data: {
            propertyId: dto.propertyId,
            userId: user.id,
            firstName: dto.firstName,
            lastName: dto.lastName,
            email: user.email,
            phone: dto.phone,
            gender: dto.gender,
            nationalIdNumber: dto.nationalIdNumber,
            income: dto.income,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const recipients = [
      property.owner,
      ...(property.manager ? [property.manager] : []),
    ];
    const notifTitle = `Nouvelle candidature — ${property.title}`;
    const notifBody = `${dto.firstName} ${dto.lastName} a soumis une candidature pour ${property.title} (${property.city}).`;

    try {
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
              applicantEmail: user.email,
              applicantPhone: dto.phone,
              propertyTitle: property.title,
            },
          }),
        ]),
      );
    } catch (err) {
      this.logger.warn(
        `Owner/manager notification failed for application ${application.id}: ${err}`,
      );
    }

    return { applicationId: application.id, status: application.status };
  }

  async addAttachments(
    user: AuthUser,
    id: string,
    files: Express.Multer.File[],
  ) {
    if (!files || files.length === 0) throw new BadRequestException('NO_FILES');

    const existing = await this.prisma.application.findUnique({
      where: { id },
      select: { id: true, userId: true, status: true, attachments: true },
    });
    if (!existing) throw new NotFoundException('APPLICATION_NOT_FOUND');
    if (existing.userId !== user.id)
      throw new ForbiddenException('NOT_APPLICATION_OWNER');
    if (existing.status !== ApplicationStatus.PENDING) {
      throw new ConflictException('APPLICATION_ALREADY_DECIDED');
    }
    if (existing.attachments.length + files.length > MAX_ATTACHMENTS) {
      throw new BadRequestException('TOO_MANY_ATTACHMENTS');
    }

    const uploadedUrls = await Promise.all(
      files.map(async (file) => {
        const extMatch = file.originalname.match(/\.(\w+)$/);
        const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
        const fileId = randomUUID();
        const key = `applications/${id}/${fileId}.${ext}`;
        return this.storage.uploadBuffer(key, file.buffer, file.mimetype);
      }),
    );

    const updated = await this.prisma.application.update({
      where: { id },
      data: { attachments: { push: uploadedUrls } },
      select: { attachments: true },
    });

    return { attachments: updated.attachments };
  }

  async findMyApplications(userId: string) {
    const data = await this.repository.findByUser(userId);
    return { data };
  }

  async search(
    user: AuthUser,
    query: ISearchRequest,
  ): Promise<PaginatedResult<Application>> {
    const propertyId = query.filters?.propertyId?.[0];
    if (!propertyId) throw new NotFoundException('PROPERTY_NOT_FOUND');

    await this.authorizeProperty(user, propertyId);
    return this.findWithPagination(query, { propertyId });
  }

  async updateStatus(user: AuthUser, id: string, status: ApplicationStatus) {
    const application = await this.prisma.application.findUnique({
      where: { id },
      select: {
        id: true,
        propertyId: true,
        userId: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true,
        property: { select: { title: true } },
      },
    });
    if (!application) throw new NotFoundException('APPLICATION_NOT_FOUND');

    await this.authorizeProperty(user, application.propertyId);
    if (application.status !== ApplicationStatus.PENDING) {
      throw new ConflictException('APPLICATION_ALREADY_DECIDED');
    }

    const updated = await this.update(id, {
      status,
    } as Partial<ApplicationCreateData>);

    const isAccepted = status === ApplicationStatus.ACCEPTED;
    const notifTitle = isAccepted
      ? 'Candidature acceptée'
      : 'Candidature non retenue';
    const notifBody = isAccepted
      ? `Votre dossier a été accepté pour ${application.property.title}.`
      : `Votre dossier n'a pas été retenu pour ${application.property.title}.`;

    try {
      await Promise.all([
        this.notificationRepo.create({
          userId: application.userId,
          type: isAccepted ? 'APPLICATION_ACCEPTED' : 'APPLICATION_REJECTED',
          title: notifTitle,
          body: notifBody,
        }),
        this.emailQueue.sendEmail({
          to: application.email,
          subject: notifTitle,
          template: isAccepted
            ? 'application-accepted'
            : 'application-rejected',
          data: {
            candidateName: `${application.firstName} ${application.lastName}`,
            propertyTitle: application.property.title,
            message: notifBody,
          },
        }),
      ]);
    } catch (err) {
      this.logger.warn(
        `Candidate notification failed for application ${id}: ${err}`,
      );
    }

    return updated;
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
      const mandate = await this.mandateRepo.findActiveByManager(
        user.id,
        propertyId,
      );
      if (!mandate) throw new ForbiddenException('NO_ACTIVE_MANDATE');
    }

    return property;
  }
}
