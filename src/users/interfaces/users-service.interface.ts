import { Role } from '@prisma/client';
import type { PaginatedResult } from '../../common/interfaces/paginated-result.interface';
import type { UserView } from '../user.repository';
import type { AdminUpdateUserDto, DelegationDto, UpdateProfileDto } from '../dto/update-user.dto';

export const USERS_SERVICE = 'IUsersService';

export interface IUsersService {
  getProfile(userId: string): Promise<UserView>;
  updateProfile(userId: string, dto: UpdateProfileDto): Promise<UserView>;
  updateAvatar(userId: string, avatarUrl: string): Promise<{ id: string; avatarUrl: string | null }>;
  listUsers(query: {
    role?: Role;
    search?: string;
    isActive?: boolean;
    page?: number;
    limit?: number;
  }): Promise<PaginatedResult<UserView>>;
  getUserById(id: string): Promise<UserView>;
  adminUpdateUser(id: string, dto: AdminUpdateUserDto): Promise<UserView>;
  softDeleteUser(id: string): Promise<void>;
  delegate(ownerId: string, dto: DelegationDto): Promise<{ message: string }>;
  revokeDelegate(ownerId: string, managerId: string): Promise<{ message: string }>;
}
