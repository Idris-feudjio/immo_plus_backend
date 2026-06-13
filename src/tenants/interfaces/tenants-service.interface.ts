import { Application, ApplicationStatus, Tenant } from '@prisma/client';
import type { PaginatedResult } from '../../common/interfaces/paginated-result.interface';
import type {
  CreateApplicationDto,
  CreateTenantDto,
  UpdateApplicationDto,
  UpdateTenantDto,
} from '../dto/tenant.dto';

export const TENANTS_SERVICE = 'ITenantsService';

export interface ITenantsService {
  list(
    ownerId: string,
    role: string,
    query: { search?: string; page?: number; limit?: number },
  ): Promise<PaginatedResult<Tenant>>;
  create(ownerId: string, dto: CreateTenantDto): Promise<Tenant>;
  getById(id: string, ownerId: string, role: string): Promise<Tenant>;
  update(id: string, ownerId: string, role: string, dto: UpdateTenantDto): Promise<Tenant>;
  createApplication(propertySlug: string, dto: CreateApplicationDto): Promise<Application>;
  listApplications(propertyId: string): Promise<Application[]>;
  updateApplication(
    propertyId: string,
    applicationId: string,
    dto: UpdateApplicationDto,
  ): Promise<Application>;
  getMyPayments(userId: string): Promise<{ data: unknown[] }>;
}
