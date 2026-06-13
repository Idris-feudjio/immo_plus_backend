import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Agency, AgencyMember, AgencyMemberRole, AgencyStatus, MandateStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import type { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import type { AddAgencyMemberDto, CreateAgencyDto, ListAgenciesDto } from './dto/agency.dto';
import type { IAgencyService, PublicAgencyProfile } from './interfaces/agency-service.interface';

@Injectable()
export class AgenciesService implements IAgencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async create(dto: CreateAgencyDto): Promise<Agency> {
    return this.prisma.agency.create({
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        address: dto.address,
        rccm: dto.rccm,
        status: AgencyStatus.ACTIVE,
      },
    });
  }

  async suspend(id: string): Promise<Agency> {
    const existing = await this.prisma.agency.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException('AGENCY_NOT_FOUND');

    return this.prisma.agency.update({
      where: { id },
      data: { status: AgencyStatus.SUSPENDED },
    });
  }

  async list(query: ListAgenciesDto): Promise<PaginatedResult<Agency & { _count: { members: number } }>> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 10));
    const skip = (page - 1) * limit;

    const where: Prisma.AgencyWhereInput = {};

    const [data, total] = await Promise.all([
      this.prisma.agency.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { members: true } } },
      }),
      this.prisma.agency.count({ where }),
    ]);

    return {
      data: data as (Agency & { _count: { members: number } })[],
      meta: {
        total,
        pageNumber: page - 1,
        pageSize: limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async addMember(
    agencyId: string,
    requesterId: string,
    requesterRole: string,
    dto: AddAgencyMemberDto,
  ): Promise<AgencyMember> {
    // Check agency exists
    const agency = await this.prisma.agency.findUnique({ where: { id: agencyId }, select: { id: true } });
    if (!agency) throw new NotFoundException('AGENCY_NOT_FOUND');

    // Auth check: must be ADMIN or agency ADMIN member
    if (requesterRole !== Role.ADMIN) {
      const requesterMembership = await this.prisma.agencyMember.findFirst({
        where: { agencyId, userId: requesterId, role: AgencyMemberRole.ADMIN },
        select: { id: true },
      });
      if (!requesterMembership) throw new ForbiddenException('INSUFFICIENT_PERMISSIONS');
    }

    // Validate user exists and is a MANAGER
    const user = await this.prisma.user.findUnique({ where: { id: dto.userId }, select: { id: true, role: true } });
    if (!user) throw new NotFoundException('USER_NOT_FOUND');
    if (user.role !== Role.MANAGER) throw new UnprocessableEntityException('USER_NOT_MANAGER');

    // Check for duplicate (userId is unique in AgencyMember)
    try {
      return await this.prisma.agencyMember.create({
        data: {
          agencyId,
          userId: dto.userId,
          role: dto.role ?? AgencyMemberRole.MEMBER,
        },
      });
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('MANAGER_ALREADY_IN_AGENCY');
      }
      throw err;
    }
  }

  async removeMember(agencyId: string, memberId: string): Promise<void> {
    const member = await this.prisma.agencyMember.findFirst({
      where: { id: memberId, agencyId },
      select: { id: true },
    });
    if (!member) throw new NotFoundException('MEMBER_NOT_FOUND');
    await this.prisma.agencyMember.delete({ where: { id: memberId } });
  }

  async getPublicProfile(id: string): Promise<PublicAgencyProfile> {
    const cacheKey = `agency:${id}:profile`;
    const cached = await this.cache.get<PublicAgencyProfile>(cacheKey);
    if (cached) return cached;

    const agency = await this.prisma.agency.findUnique({
      where: { id },
      select: { id: true, name: true, address: true, phone: true, email: true },
    });
    if (!agency) throw new NotFoundException('AGENCY_NOT_FOUND');

    const managedPropertiesCount = await this.prisma.mandate.count({
      where: {
        agencyId: id,
        status: MandateStatus.ACTIVE,
        deletedAt: null,
        property: { isPublished: true },
      },
    });

    const profile: PublicAgencyProfile = {
      id: agency.id,
      name: agency.name,
      address: agency.address,
      phone: agency.phone,
      email: agency.email,
      managedPropertiesCount,
    };

    await this.cache.set(cacheKey, profile, 1800);
    return profile;
  }
}
