import { Injectable } from '@nestjs/common';
import { Mandate, MandateStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import type { ListMandatesDto } from './dto/mandate.dto';

@Injectable()
export class MandateRepository {
  constructor(private readonly prisma: PrismaService) {}

  findActiveByManager(
    managerId: string,
    propertyId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.mandate.findFirst({
      where: {
        managerId,
        propertyId,
        status: MandateStatus.ACTIVE,
        deletedAt: null,
      },
      select: { id: true },
    });
  }

  findById(id: string): Promise<Mandate | null> {
    return this.prisma.mandate.findFirst({
      where: { id, deletedAt: null },
      include: {
        property: true,
        agency: true,
        manager: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    }) as Promise<Mandate | null>;
  }

  create(data: Prisma.MandateUncheckedCreateInput): Promise<Mandate> {
    return this.prisma.mandate.create({ data });
  }

  updateStatus(id: string, status: MandateStatus): Promise<Mandate> {
    return this.prisma.mandate.update({
      where: { id },
      data: { status },
      include: {
        property: true,
        agency: true,
        manager: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    }) as Promise<Mandate>;
  }

  findDuplicate(
    propertyId: string,
    agencyId: string,
    managerId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.mandate.findFirst({
      where: {
        propertyId,
        agencyId,
        managerId,
        status: MandateStatus.ACTIVE,
        deletedAt: null,
      },
      select: { id: true },
    });
  }

  async findListPaginated(
    userId: string,
    role: string,
    query: ListMandatesDto,
  ): Promise<PaginatedResult<Mandate>> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 10));
    const skip = (page - 1) * limit;

    const where: Prisma.MandateWhereInput = { deletedAt: null };

    if (role === Role.OWNER) {
      where.property = { ownerId: userId };
    } else if (role === Role.MANAGER) {
      where.managerId = userId;
    }
    // ADMIN: no additional filter

    if (query.status) where.status = query.status;
    if (query.propertyId) where.propertyId = query.propertyId;
    if (query.agencyId) where.agencyId = query.agencyId;

    const [data, total] = await Promise.all([
      this.prisma.mandate.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { property: true, agency: true },
      }),
      this.prisma.mandate.count({ where }),
    ]);

    return {
      data: data as Mandate[],
      meta: {
        total,
        pageNumber: page - 1,
        pageSize: limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
