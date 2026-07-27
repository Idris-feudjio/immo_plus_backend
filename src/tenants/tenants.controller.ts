import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { SearchRequestDto } from '../common/dto/pagination.dto';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { CreateTenantDto, UpdateTenantDto } from './dto/tenant.dto';
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
      {
        searchKey: search,
        pageNumber: page - 1,
        pageSize: limit,
        sortClauses: [{ fieldName: 'createdAt', direction: 'DESC' }],
      },
      baseWhere,
    );
  }

  @Post('search')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Recherche paginée de locataires' })
  findWithPagination(
    @CurrentUser() user: AuthUser,
    @Body() body: SearchRequestDto,
  ) {
    const baseWhere = user.role !== Role.ADMIN ? { ownerId: user.id } : {};
    return this.service.findWithPagination(body, baseWhere);
  }

  @Post('search/all')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Liste complète des locataires sans pagination (admin)',
  })
  findAll(@Body() body: SearchRequestDto) {
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
