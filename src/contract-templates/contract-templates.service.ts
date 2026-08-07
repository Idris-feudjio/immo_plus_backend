import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContractTemplate, Role } from '@prisma/client';
import { BaseService } from '../common/abstractions/base.service';
import type { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import type { ISearchRequest } from '../common/interfaces/search-request.interface';
import { buildMeta } from '../common/utils/pagination.util';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateContractTemplateDto,
  UpdateContractTemplateDto,
} from './dto/contract-template.dto';
import {
  ContractTemplateCreateData,
  ContractTemplateRepository,
} from './contract-template.repository';

@Injectable()
export class ContractTemplatesService extends BaseService<
  ContractTemplate,
  ContractTemplateCreateData
> {
  constructor(
    protected override readonly repository: ContractTemplateRepository,
    private readonly prisma: PrismaService,
  ) {
    super(repository);
  }

  private async resolveAgencyId(userId: string): Promise<string> {
    const membership = await this.prisma.agencyMember.findFirst({
      where: { userId },
      select: { agencyId: true },
    });
    if (!membership) {
      throw new ForbiddenException({
        error: 'MANAGER_NOT_IN_AGENCY',
        message:
          'Vous devez appartenir à une agence pour créer un modèle de contrat',
      });
    }
    return membership.agencyId;
  }

  /** Like resolveAgencyId(), but returns null instead of throwing when the caller has no
   * agency membership — templates are agency-scoped, so a non-agency caller (e.g. an OWNER)
   * legitimately just has zero templates; that isn't an error worth a 403 for a read. */
  private async tryResolveAgencyId(userId: string): Promise<string | null> {
    const membership = await this.prisma.agencyMember.findFirst({
      where: { userId },
      select: { agencyId: true },
    });
    return membership?.agencyId ?? null;
  }

  async createTemplate(
    userId: string,
    dto: CreateContractTemplateDto,
  ): Promise<ContractTemplate> {
    const agencyId = await this.resolveAgencyId(userId);

    return this.repository.create({
      agencyId,
      name: dto.name,
      lockedSections: dto.lockedSections ?? [],
      clauses: {
        create: (dto.clauses ?? []).map((text, order) => ({ text, order })),
      },
    });
  }

  async search(
    userId: string,
    role: string,
    query: ISearchRequest,
  ): Promise<PaginatedResult<ContractTemplate>> {
    if (role === Role.ADMIN) {
      return this.repository.findWithPagination(query, {});
    }

    const agencyId = await this.tryResolveAgencyId(userId);
    if (!agencyId) {
      return {
        data: [],
        meta: buildMeta(0, query.pageNumber ?? 0, query.pageSize ?? 20),
      };
    }
    return this.repository.findWithPagination(query, { agencyId });
  }

  /** Shared lookup + agency-ownership check for getOneScoped()/updateTemplate(). */
  private async findTemplateForAgencyAccess(
    id: string,
    userId: string,
    role: string,
  ): Promise<ContractTemplate> {
    const template = await this.repository.findById(id);
    if (!template) throw new NotFoundException('CONTRACT_TEMPLATE_NOT_FOUND');

    if (role !== Role.ADMIN) {
      const agencyId = await this.resolveAgencyId(userId);
      if (agencyId !== template.agencyId) {
        throw new ForbiddenException({
          error: 'NOT_TEMPLATE_AGENCY',
          message: "Ce modèle n'appartient pas à votre agence",
        });
      }
    }

    return template;
  }

  async getOneScoped(
    id: string,
    userId: string,
    role: string,
  ): Promise<ContractTemplate> {
    return this.findTemplateForAgencyAccess(id, userId, role);
  }

  async updateTemplate(
    id: string,
    userId: string,
    role: string,
    dto: UpdateContractTemplateDto,
  ): Promise<ContractTemplate> {
    await this.findTemplateForAgencyAccess(id, userId, role);

    // Only ContractTemplate/ContractTemplateClause rows are touched here —
    // existing Contract/ContractClause rows are independent copies made at
    // contract-creation time (story 5.2) and hold no live reference back to
    // the template, so they are unaffected by construction (AC#3).
    return this.prisma.$transaction(async (tx) => {
      if (dto.clauses !== undefined) {
        await tx.contractTemplateClause.deleteMany({
          where: { templateId: id },
        });
      }

      return tx.contractTemplate.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.lockedSections !== undefined
            ? { lockedSections: dto.lockedSections }
            : {}),
          ...(dto.clauses !== undefined
            ? {
                clauses: {
                  create: dto.clauses.map((text, order) => ({ text, order })),
                },
              }
            : {}),
        },
        include: { clauses: { orderBy: { order: 'asc' } } },
      });
    });
  }
}
