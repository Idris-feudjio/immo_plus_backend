import type { Role } from '@prisma/client';

export const ADMIN_SERVICE = 'IAdminService';

export interface ListUsersQuery {
  page?: number;
  limit?: number;
  role?: Role;
  isActive?: boolean;
  search?: string;
}

export interface IAdminService {
  getGlobalStats(): Promise<unknown>;
  getSettings(): Promise<unknown>;
  updateSettings(body: Record<string, unknown>): Promise<unknown>;
  listUsers(query: ListUsersQuery): Promise<unknown>;
  deactivateUser(id: string): Promise<unknown>;
}
