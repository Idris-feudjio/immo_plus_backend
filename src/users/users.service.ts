import { Injectable, NotFoundException } from '@nestjs/common';
import { User } from '@prisma/client';
import { BaseService } from '../common/abstractions/base.service';
import { DelegationDto } from './dto/update-user.dto';
import { UserCreateData, UserRepository, UserView } from './user.repository';

@Injectable()
export class UsersService extends BaseService<User, UserCreateData, UserView> {
  constructor(protected override readonly repository: UserRepository) {
    super(repository);
  }

  async updateAvatar(userId: string, avatarUrl: string): Promise<{ id: string; avatarUrl: string | null }> {
    const user = await this.repository.update(userId, { avatarUrl });
    return { id: user.id, avatarUrl: user.avatarUrl };
  }

  override async delete(id: string): Promise<void> {
    await this.findByIdOrThrow(id);
    await this.repository.update(id, { isActive: false });
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
