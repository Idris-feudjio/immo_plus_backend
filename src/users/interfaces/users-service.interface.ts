import type { PaginatedResult } from '../../common/interfaces/paginated-result.interface';
import type { SearchRequest } from '../../common/interfaces/search-request.interface';
import type { UserView } from '../user.repository';
import type { AdminUpdateUserDto, DelegationDto, UpdateProfileDto } from '../dto/update-user.dto';

export interface IUsersService {
  getProfile(userId: string): Promise<UserView>;
  updateProfile(userId: string, dto: UpdateProfileDto): Promise<UserView>;
  updateAvatar(userId: string, avatarUrl: string): Promise<{ id: string; avatarUrl: string | null }>;
  listUsers(query: SearchRequest): Promise<PaginatedResult<UserView>>;
  getUserById(id: string): Promise<UserView>;
  adminUpdateUser(id: string, dto: AdminUpdateUserDto): Promise<UserView>;
  softDeleteUser(id: string): Promise<void>;
  delegate(ownerId: string, dto: DelegationDto): Promise<{ message: string }>;
  revokeDelegate(ownerId: string, managerId: string): Promise<{ message: string }>;
}
