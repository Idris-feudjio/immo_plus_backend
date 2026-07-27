import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Tenant } from '@prisma/client';
import { BaseService } from '../common/abstractions/base.service';
import { CreateTenantDto, UpdateTenantDto } from './dto/tenant.dto';
import { TenantCreateData, TenantRepository } from './tenant.repository';

@Injectable()
export class TenantsService extends BaseService<Tenant, TenantCreateData> {
  constructor(protected override readonly repository: TenantRepository) {
    super(repository);
  }

  // ── Tenant CRUD ──────────────────────────────────────────────────────────────

  /** Create a tenant, linking an existing user account if the email matches. */
  async createTenant(ownerId: string, dto: CreateTenantDto): Promise<Tenant> {
    const existingUser = await this.repository.findUserByEmail(dto.email);
    return this.create({ ...dto, ownerId, userId: existingUser?.id });
  }

  /** Get a tenant with full relation details, enforcing ownership for non-admins. */
  async getByIdWithDetails(
    id: string,
    ownerId: string,
    role: string,
  ): Promise<Tenant> {
    const tenant = await this.repository.findByIdWithRelations(id);
    if (!tenant) throw new NotFoundException('Locataire introuvable.');
    if (role !== 'ADMIN' && tenant.ownerId !== ownerId) {
      throw new ForbiddenException({
        error: 'INSUFFICIENT_PERMISSIONS',
        message: 'Droits insuffisants.',
      });
    }
    return tenant;
  }

  /** Update a tenant, enforcing ownership for non-admins. */
  async updateTenant(
    id: string,
    ownerId: string,
    role: string,
    dto: UpdateTenantDto,
  ): Promise<Tenant> {
    const tenant = await this.findByIdOrThrow(id);
    if (role !== 'ADMIN' && tenant.ownerId !== ownerId) {
      throw new ForbiddenException({
        error: 'INSUFFICIENT_PERMISSIONS',
        message: 'Droits insuffisants.',
      });
    }
    return this.repository.update(id, dto);
  }

  // ── Tenant self-service ──────────────────────────────────────────────────────

  async getMyPayments(userId: string): Promise<{ data: unknown[] }> {
    const tenant = await this.repository.findByUserId(userId);
    if (!tenant) throw new NotFoundException('Locataire introuvable.');
    const data = await this.repository.findPaymentsForTenant(tenant.id);
    return { data };
  }
}
