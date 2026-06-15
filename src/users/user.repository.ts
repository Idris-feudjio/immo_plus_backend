import { Injectable } from '@nestjs/common';
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
  isActive?: boolean;
  avatarUrl?: string;
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
export class UserRepository extends BaseRepository<User, UserCreateData, UserView> {
  constructor(private readonly prisma: PrismaService) {
    super(
      prisma.user as unknown as PrismaModelDelegate<User>,
      USER_QUERY_FIELDS,
    );
  }

  override findById(id: string): Promise<UserView | null> {
    return this.prisma.user.findUnique({ where: { id }, select: USER_SELECT }) as Promise<UserView | null>;
  }

  override async findAll(
    request?: SearchRequest,
    baseWhere: Record<string, unknown> = {},
  ): Promise<UserView[]> {
    const where = this.buildSearchWhere(request ?? {}, baseWhere);
    const data = await this.prisma.user.findMany({ where, select: USER_SELECT });
    return data as unknown as UserView[];
  }

  override update(id: string, data: Partial<UserCreateData>): Promise<UserView> {
    return this.prisma.user.update({ where: { id }, data, select: USER_SELECT }) as Promise<UserView>;
  }

  override async findWithPagination(request: SearchRequest): Promise<PaginatedResult<UserView>> {
    const pageNumber = request.pageNumber ?? 0;
    const pageSize = request.pageSize ?? 20;
    const where = this.buildSearchWhere(request);
    const orderBy = this.buildSearchOrderBy(
      request.sortClauses ?? [{ fieldName: 'createdAt', direction: 'DESC' }],
    );

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: pageNumber * pageSize,
        take: pageSize,
        select: USER_SELECT,
        orderBy: orderBy.length ? orderBy : { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { data: data as unknown as UserView[], meta: buildMeta(total, pageNumber, pageSize) };
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
