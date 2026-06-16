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
import { BaseService } from '../common/abstractions/base.service';
import type { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import type { ISearchRequest } from '../common/interfaces/search-request.interface';
import type { AddAgencyMemberDto, CreateAgencyDto } from './dto/agency.dto';
import type { PublicAgencyProfile } from './dto/agency.dto';
import { AgencyCreateData, AgencyRepository } from './agency.repository';

@Injectable()
export class AgenciesService extends BaseService<Agency, AgencyCreateData> {
  constructor(
    protected override readonly repository: AgencyRepository,
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {
    super(repository);
  }

  async createAgency(dto: CreateAgencyDto): Promise<Agency> {
    return this.repository.create({
      name: dto.name,
      email: dto.email,
      phone: dto.phone,
      address: dto.address,
      rccm: dto.rccm,
      status: AgencyStatus.ACTIVE,
    });
  }

  async suspend(id: string): Promise<Agency> {
    const existing = await this.prisma.agency.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException('AGENCY_NOT_FOUND');
    return this.update(id, { status: AgencyStatus.SUSPENDED });
  }

  search(query: ISearchRequest): Promise<PaginatedResult<Agency>> {
    return this.findWithPagination(query, {});
  }

  async addMember(
    agencyId: string,
    requesterId: string,
    requesterRole: string,
    dto: AddAgencyMemberDto,
  ): Promise<AgencyMember> {
    const agency = await this.prisma.agency.findUnique({ where: { id: agencyId }, select: { id: true } });
    if (!agency) throw new NotFoundException('AGENCY_NOT_FOUND');

    if (requesterRole !== Role.ADMIN) {
      const requesterMembership = await this.prisma.agencyMember.findFirst({
        where: { agencyId, userId: requesterId, role: AgencyMemberRole.ADMIN },
        select: { id: true },
      });
      if (!requesterMembership) throw new ForbiddenException('INSUFFICIENT_PERMISSIONS');
    }

    const user = await this.prisma.user.findUnique({ where: { id: dto.userId }, select: { id: true, role: true } });
    if (!user) throw new NotFoundException('USER_NOT_FOUND');
    if (user.role !== Role.MANAGER) throw new UnprocessableEntityException('USER_NOT_MANAGER');

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
