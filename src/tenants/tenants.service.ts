import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Application, Tenant } from '@prisma/client';
import type { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import {
  CreateApplicationDto,
  CreateTenantDto,
  UpdateApplicationDto,
  UpdateTenantDto,
} from './dto/tenant.dto';
import type { ITenantsService } from './interfaces/tenants-service.interface';
import { TenantRepository } from './tenant.repository';

@Injectable()
export class TenantsService implements ITenantsService {
  constructor(private readonly repository: TenantRepository) {}

  list(
    ownerId: string,
    role: string,
    query: { search?: string; page?: number; limit?: number },
  ): Promise<PaginatedResult<Tenant>> {
    return this.repository.findListPaginated(ownerId, role, query);
  }

  async create(ownerId: string, dto: CreateTenantDto): Promise<Tenant> {
    const existingUser = await this.repository.findUserByEmail(dto.email);
    return this.repository.create({
      ...dto,
      ownerId,
      userId: existingUser?.id,
    });
  }

  async getById(id: string, ownerId: string, role: string): Promise<Tenant> {
    const tenant = await this.repository.findByIdWithRelations(id);
    if (!tenant) throw new NotFoundException('Locataire introuvable.');
    if (role !== 'ADMIN' && (tenant as never as { ownerId: string }).ownerId !== ownerId) {
      throw new ForbiddenException({ error: 'INSUFFICIENT_PERMISSIONS', message: 'Droits insuffisants.' });
    }
    return tenant;
  }

  async update(id: string, ownerId: string, role: string, dto: UpdateTenantDto): Promise<Tenant> {
    await this.getById(id, ownerId, role);
    return this.repository.update(id, dto as never);
  }

  async createApplication(propertySlug: string, dto: CreateApplicationDto): Promise<Application> {
    const property = await this.repository.findPropertyBySlug(propertySlug);
    if (!property) throw new NotFoundException('Bien introuvable.');

    const application = await this.repository.createApplication({
      propertyId: property.id,
      tenantId: dto.tenantId,
      message: dto.message,
      income: dto.income,
      occupation: dto.occupation,
    });

    await this.repository.createNotification({
      userId: property.ownerId,
      type: 'application_received',
      title: 'Nouvelle candidature',
      body: `Une nouvelle candidature a été reçue pour "${property.title}".`,
      link: `/properties/${property.id}/applications`,
    });

    return application;
  }

  listApplications(propertyId: string): Promise<Application[]> {
    return this.repository.findApplications(propertyId);
  }

  async updateApplication(
    propertyId: string,
    applicationId: string,
    dto: UpdateApplicationDto,
  ): Promise<Application> {
    await this.repository.findApplicationByIdOrThrow(applicationId, propertyId);
    return this.repository.updateApplicationStatus(applicationId, dto.status);
  }

  async getMyPayments(userId: string): Promise<{ data: unknown[] }> {
    const tenant = await this.repository.findByUserId(userId);
    if (!tenant) throw new NotFoundException('Locataire introuvable.');
    const data = await this.repository.findPaymentsForTenant(tenant.id);
    return { data };
  }
}
