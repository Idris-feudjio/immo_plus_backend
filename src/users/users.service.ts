import { Injectable, NotFoundException } from '@nestjs/common';
import { User } from '@prisma/client';
import { BaseService } from '../common/abstractions/base.service';
import { AdminUpdateUserDto, DelegationDto, UpdateProfileDto } from './dto/update-user.dto';
import type { IUsersService } from './interfaces/users-service.interface';
import { UserCreateData, UserRepository, UserView } from './user.repository';

@Injectable()
export class UsersService extends BaseService<User, UserCreateData> implements IUsersService {
  constructor(protected override readonly repository: UserRepository) {
    super(repository);
  }

  getProfile(userId: string): Promise<UserView> {
    return this.repository.findByIdProjectedOrThrow(userId);
  }

  updateProfile(userId: string, dto: UpdateProfileDto): Promise<UserView> {
    return this.repository.updateProjected(userId, dto);
  }

  async updateAvatar(userId: string, avatarUrl: string): Promise<{ id: string; avatarUrl: string | null }> {
    const user = await this.repository.updateProjected(userId, { avatarUrl });
    return { id: user.id, avatarUrl: user.avatarUrl };
  }

  getUserById(id: string): Promise<UserView> {
    return this.repository.findByIdProjectedOrThrow(id);
  }

  async adminUpdateUser(id: string, dto: AdminUpdateUserDto): Promise<UserView> {
    await this.repository.findByIdProjectedOrThrow(id);
    return this.repository.updateProjected(id, dto);
  }

  override async delete(id: string): Promise<void> {
    await this.repository.findByIdProjectedOrThrow(id);
    await this.repository.updateProjected(id, { isActive: false });
  }

  async delegate(ownerId: string, dto: DelegationDto): Promise<{ message: string }> {
    const manager = await this.repository.findManagerById(dto.managerId);
    if (!manager) throw new NotFoundException('Gestionnaire introuvable.');

    await this.repository.assignManagerToProperties(ownerId, dto.propertyIds, dto.managerId);
    return { message: 'Délégation accordée avec succès.' };
  }

  async revokeDelegate(ownerId: string, managerId: string): Promise<{ message: string }> {
    await this.repository.revokeManagerFromProperties(ownerId, managerId);
    return { message: 'Délégation révoquée avec succès.' };
  }
}
