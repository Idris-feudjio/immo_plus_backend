import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { TurnstileGuard } from '../common/guards/turnstile.guard.js';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import {
  CreateApplicationDto,
  CreateTenantDto,
  UpdateApplicationDto,
  UpdateTenantDto,
} from './dto/tenant.dto';
import { TenantsService } from './tenants.service';

@ApiTags('Tenants')
@Controller('tenants')
export class TenantsController {
  constructor(private readonly service: TenantsService) {}

  @Get()
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Liste des locataires avec contrat actif' })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: { search?: string; page?: number; limit?: number },
  ) {
    const { page = 1, limit = 20, search } = query;
    const baseWhere = user.role !== Role.ADMIN ? { ownerId: user.id } : {};
    return this.service.findWithPagination(
      { searchKey: search, pageNumber: page - 1, pageSize: limit, sortClauses: [{ fieldName: 'createdAt', direction: 'DESC' }] },
      baseWhere,
    );
  }

  @Post('search')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Recherche paginée de locataires' })
  findWithPagination(@CurrentUser() user: AuthUser, @Body() body: PaginationDto) {
    const baseWhere = user.role !== Role.ADMIN ? { ownerId: user.id } : {};
    return this.service.findWithPagination(body, baseWhere);
  }

  @Post('search/all')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Liste complète des locataires sans pagination (admin)' })
  findAll(@Body() body: PaginationDto) {
    return this.service.findAll(body);
  }

  @Post()
  @Roles(Role.OWNER, Role.MANAGER)
  @ApiOperation({ summary: 'Créer un locataire' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTenantDto) {
    return this.service.createTenant(user.id, dto);
  }

  @Get('me/payments')
  @Roles(Role.TENANT)
  @ApiOperation({ summary: 'Mes paiements (locataire)' })
  getMyPayments(@CurrentUser() user: AuthUser) {
    return this.service.getMyPayments(user.id);
  }

  @Get(':id')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: "Détail d'un locataire avec historique" })
  getOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.getByIdWithDetails(id, user.id, user.role);
  }

  @Patch(':id')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Modifier un locataire' })
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateTenantDto,
  ) {
    return this.service.updateTenant(id, user.id, user.role, dto);
  }
}

@ApiTags('Properties')
@Controller('properties')
export class ApplicationsController {
  constructor(private readonly service: TenantsService) {}

  @Public()
  @UseGuards(TurnstileGuard)
  @Throttle({ default: { limit: 5, ttl: 3600000 } })
  @Post(':slug/applications')
  @ApiOperation({ summary: 'Déposer une candidature' })
  create(@Param('slug') slug: string, @Body() dto: CreateApplicationDto) {
    return this.service.createApplication(slug, dto);
  }

  @Get(':id/applications')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: "Liste des candidatures d'un bien" })
  list(@Param('id') id: string) {
    return this.service.listApplications(id);
  }

  @Patch(':id/applications/:applicationId')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: "Mettre à jour le statut d'une candidature" })
  updateStatus(
    @Param('id') id: string,
    @Param('applicationId') applicationId: string,
    @Body() dto: UpdateApplicationDto,
  ) {
    return this.service.updateApplication(id, applicationId, dto);
  }
}
