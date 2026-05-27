import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AdminUpdateUserDto, DelegationDto, UpdateProfileDto } from './dto/update-user.dto';
import { PaginationDto, buildPaginationMeta } from '../common/dto/pagination.dto';
import { Role } from '@prisma/client';

const USER_SELECT = {
  id: true,
  lastName: true,
  firstName: true,
  email: true,
  phone: true,
  role: true,
  avatarUrl: true,
  emailVerified: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: USER_SELECT,
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');
    return user;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: dto,
      select: USER_SELECT,
    });
  }

  async updateAvatar(userId: string, avatarUrl: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
      select: { id: true, avatarUrl: true },
    });
  }

  async listUsers(query: PaginationDto & { role?: Role; search?: string; isActive?: boolean }) {
    const { page = 1, limit = 20, role, search, isActive } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (role) where.role = role;
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.OR = [
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({ where, skip, take: limit, select: USER_SELECT, orderBy: { createdAt: 'desc' } }),
      this.prisma.user.count({ where }),
    ]);

    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async getUserById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');
    return user;
  }

  async adminUpdateUser(id: string, dto: AdminUpdateUserDto) {
    await this.getUserById(id);
    return this.prisma.user.update({ where: { id }, data: dto, select: USER_SELECT });
  }

  async softDeleteUser(id: string) {
    await this.getUserById(id);
    await this.prisma.user.update({ where: { id }, data: { isActive: false } });
  }

  async delegate(ownerId: string, dto: DelegationDto) {
    const manager = await this.prisma.user.findFirst({
      where: { id: dto.managerId, role: Role.MANAGER },
    });
    if (!manager) throw new NotFoundException('Gestionnaire introuvable.');

    await this.prisma.property.updateMany({
      where: { id: { in: dto.propertyIds }, ownerId },
      data: { managerId: dto.managerId },
    });

    return { message: 'Délégation accordée avec succès.' };
  }

  async revokeDelegate(ownerId: string, managerId: string) {
    await this.prisma.property.updateMany({
      where: { ownerId, managerId },
      data: { managerId: null },
    });
    return { message: 'Délégation révoquée avec succès.' };
  }
}
