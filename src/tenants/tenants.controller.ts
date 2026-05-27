import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
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
  constructor(private service: TenantsService) {}

  @Get()
  @Roles(Role.owner, Role.manager, Role.admin)
  @ApiOperation({ summary: 'Liste des locataires' })
  list(@CurrentUser() user: any, @Query() query: { search?: string; page?: number; limit?: number }) {
    return this.service.list(user.id, user.role, query);
  }

  @Post()
  @Roles(Role.owner, Role.manager)
  @ApiOperation({ summary: 'Créer un locataire' })
  create(@CurrentUser() user: any, @Body() dto: CreateTenantDto) {
    return this.service.create(user.id, dto);
  }

  @Get(':id')
  @Roles(Role.owner, Role.manager, Role.admin)
  @ApiOperation({ summary: 'Détail d\'un locataire' })
  getOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.getById(id, user.id, user.role);
  }

  @Patch(':id')
  @Roles(Role.owner, Role.manager, Role.admin)
  @ApiOperation({ summary: 'Modifier un locataire' })
  update(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: UpdateTenantDto) {
    return this.service.update(id, user.id, user.role, dto);
  }
}

@ApiTags('Properties')
@Controller('properties')
export class ApplicationsController {
  constructor(private service: TenantsService) {}

  @Public()
  @Post(':slug/applications')
  @ApiOperation({ summary: 'Déposer une candidature' })
  create(@Param('slug') slug: string, @Body() dto: CreateApplicationDto) {
    return this.service.createApplication(slug, dto);
  }

  @Get(':id/applications')
  @Roles(Role.owner, Role.manager, Role.admin)
  @ApiOperation({ summary: 'Liste des candidatures d\'un bien' })
  list(@Param('id') id: string) {
    return this.service.listApplications(id);
  }

  @Patch(':id/applications/:applicationId')
  @Roles(Role.owner, Role.manager, Role.admin)
  @ApiOperation({ summary: 'Mettre à jour le statut d\'une candidature' })
  updateStatus(
    @Param('id') id: string,
    @Param('applicationId') applicationId: string,
    @Body() dto: UpdateApplicationDto,
  ) {
    return this.service.updateApplication(id, applicationId, dto);
  }
}
