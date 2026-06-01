import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role, User } from '@prisma/client';
import {
  BaseRepository,
  PrismaModelDelegate,
} from '../common/abstractions/base.repository';
import type { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import type { QueryField, SearchRequest } from '../common/interfaces/search-request.interface';
import { buildMeta } from '../common/utils/pagination.util';
import { PrismaService } from '../prisma/prisma.service';

export type UserCreateData = {
  firstName: string;
  lastName: string;
  email: string;
  passwordHash: string;
  role?: Role;
  phone?: string;
};

export type UserView = Omit<User, 'passwordHash'>;

const USER_SELECT = {
  id: true, lastName: true, firstName: true, email: true, phone: true,
  role: true, avatarUrl: true, emailVerified: true, isActive: true,
  createdAt: true, updatedAt: true,
} as const satisfies Prisma.UserSelect;

const USER_QUERY_FIELDS: QueryField[] = [
  { filterKey: 'lastName',  prismaField: 'lastName',  searchable: true },
  { filterKey: 'email',     prismaField: 'email',     searchable: true },
  { filterKey: 'role',      prismaField: 'role',      filterable: true, filterType: 'exact' },
  { filterKey: 'isActive',  prismaField: 'isActive',  filterable: true, filterType: 'boolean' },
  { filterKey: 'createdAt', prismaField: 'createdAt', sortable: true },
];

@Injectable()
export class UserRepository extends BaseRepository<User, UserCreateData> {
  constructor(private readonly prisma: PrismaService) {
    super(
      prisma.user as unknown as PrismaModelDelegate<User>,
      USER_QUERY_FIELDS,
    );
  }

  findByIdProjected(id: string): Promise<UserView | null> {
    return this.prisma.user.findUnique({ where: { id }, select: USER_SELECT }) as Promise<UserView | null>;
  }

  async findByIdProjectedOrThrow(id: string): Promise<UserView> {
    const user = await this.findByIdProjected(id);
    if (!user) throw new NotFoundException('Utilisateur introuvable.');
    return user;
  }

  updateProjected(id: string, data: object): Promise<UserView> {
    return this.prisma.user.update({ where: { id }, data, select: USER_SELECT }) as Promise<UserView>;
  }

  /** Paginated user list (admin). */
  async findListPaginated(query: {
    role?: Role;
    search?: string;
    isActive?: boolean;
    page?: number;
    limit?: number;
  }): Promise<PaginatedResult<UserView>> {
    const { page = 1, limit = 20, role, search, isActive } = query;
    const filters: Record<string, string[]> = {};
    if (role) filters.role = [role];
    if (isActive !== undefined) filters.isActive = [String(isActive)];

    const request: SearchRequest = {
      searchKey: search,
      filters,
      pageNumber: page - 1,
      pageSize: limit,
      sortClauses: [{ fieldName: 'createdAt', direction: 'DESC' }],
    };

    const where = this.buildSearchWhere(request);
    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        select: USER_SELECT,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { data: data as UserView[], meta: buildMeta(total, page - 1, limit) };
  }

  findManagerById(managerId: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { id: managerId, role: Role.MANAGER } });
  }

  async assignManagerToProperties(ownerId: string, propertyIds: string[], managerId: string): Promise<void> {
    await this.prisma.property.updateMany({
      where: { id: { in: propertyIds }, ownerId },
      data: { managerId },
    });
  }

  async revokeManagerFromProperties(ownerId: string, managerId: string): Promise<void> {
    await this.prisma.property.updateMany({
      where: { ownerId, managerId },
      data: { managerId: null },
    });
  }
}
