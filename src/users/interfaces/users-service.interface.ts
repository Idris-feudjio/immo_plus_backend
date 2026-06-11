import type { UserView } from '../user.repository';
import type { AdminUpdateUserDto, DelegationDto, UpdateProfileDto } from '../dto/update-user.dto';

export interface IUsersService {
  getProfile(userId: string): Promise<UserView>;
  updateProfile(userId: string, dto: UpdateProfileDto): Promise<UserView>;
  updateAvatar(userId: string, avatarUrl: string): Promise<{ id: string; avatarUrl: string | null }>;
  getUserById(id: string): Promise<UserView>;
  adminUpdateUser(id: string, dto: AdminUpdateUserDto): Promise<UserView>;
  delegate(ownerId: string, dto: DelegationDto): Promise<{ message: string }>;
  revokeDelegate(ownerId: string, managerId: string): Promise<{ message: string }>;
}
