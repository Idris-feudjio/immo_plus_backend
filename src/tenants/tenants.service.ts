import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateApplicationDto,
  CreateTenantDto,
  UpdateApplicationDto,
  UpdateTenantDto,
} from './dto/tenant.dto';
import { buildPaginationMeta } from '../common/dto/pagination.dto';
import { ContractStatus, Role } from '@prisma/client';

@Injectable()
export class TenantsService {
  constructor(private prisma: PrismaService) {}

  async list(ownerId: string, role: string, query: { search?: string; page?: number; limit?: number }) {
    const { page = 1, limit = 20, search } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (role !== Role.ADMIN) where.ownerId = ownerId;
    if (search) {
      where.OR = [
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        skip,
        take: limit,
        include: {
          contracts: {
            where: { status: ContractStatus.ACTIVE },
            take: 1,
            include: { property: { select: { title: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.tenant.count({ where }),
    ]);

    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async create(ownerId: string, dto: CreateTenantDto) {
    const existingUser = await this.prisma.user.findUnique({ where: { email: dto.email } });

    return this.prisma.tenant.create({
      data: {
        ...dto,
        ownerId,
        userId: existingUser?.id ?? undefined,
      },
    });
  }

  async getById(id: string, ownerId: string, role: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        contracts: {
          include: { property: { select: { id: true, title: true, slug: true } } },
          orderBy: { createdAt: 'desc' },
        },
        payments: { orderBy: { dueDate: 'desc' }, take: 20 },
      },
    });
    if (!tenant) throw new NotFoundException('Locataire introuvable.');
    if (role !== Role.ADMIN && tenant.ownerId !== ownerId) {
      throw new ForbiddenException({ error: 'INSUFFICIENT_PERMISSIONS', message: 'Droits insuffisants.' });
    }
    return tenant;
  }

  async update(id: string, ownerId: string, role: string, dto: UpdateTenantDto) {
    await this.getById(id, ownerId, role);
    return this.prisma.tenant.update({ where: { id }, data: dto });
  }

  async createApplication(propertySlug: string, dto: CreateApplicationDto) {
    const property = await this.prisma.property.findFirst({ where: { slug: propertySlug, deletedAt: null } });
    if (!property) throw new NotFoundException('Bien introuvable.');

    const application = await this.prisma.application.create({
      data: {
        propertyId: property.id,
        tenantId: dto.tenantId,
        message: dto.message,
        income: dto.income,
        occupation: dto.occupation,
      },
    });

    await this.prisma.notification.create({
      data: {
        userId: property.ownerId,
        type: 'application_received',
        title: 'Nouvelle candidature',
        body: `Une nouvelle candidature a été reçue pour "${property.title}".`,
        link: `/properties/${property.id}/applications`,
      },
    });

    return application;
  }

  async listApplications(propertyId: string) {
    return this.prisma.application.findMany({
      where: { propertyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateApplication(propertyId: string, applicationId: string, dto: UpdateApplicationDto) {
    const app = await this.prisma.application.findFirst({ where: { id: applicationId, propertyId } });
    if (!app) throw new NotFoundException('Candidature introuvable.');
    return this.prisma.application.update({ where: { id: applicationId }, data: { status: dto.status } });
  }
}
