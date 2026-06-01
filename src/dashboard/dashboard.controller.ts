import {
  Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { FilterPropertiesDto } from '../properties/dto/create-property.dto';
import type { IPropertyService } from '../properties/interfaces/property-service.interface';
import { PROPERTY_SERVICE } from '../properties/interfaces/property-service.interface';
import type { IDashboardService } from './interfaces/dashboard-service.interface';
import { DASHBOARD_SERVICE } from './interfaces/dashboard-service.interface';

@ApiTags('Dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(
    @Inject(DASHBOARD_SERVICE) private readonly service: IDashboardService,
    @Inject(PROPERTY_SERVICE) private readonly properties: IPropertyService,
  ) {}

  @Get('stats')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Tableau de bord propriétaire / gestionnaire' })
  getStats(@CurrentUser() user: AuthUser) {
    return this.service.getOwnerStats(user.id, user.role);
  }

  @Get('tenant')
  @Roles(Role.TENANT)
  @ApiOperation({ summary: 'Espace locataire' })
  getTenantDashboard(@CurrentUser() user: AuthUser) {
    return this.service.getTenantDashboard(user.id);
  }

  @Get('properties')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Biens du dashboard (avec non publiés)' })
  getProperties(@CurrentUser() user: AuthUser, @Query() query: FilterPropertiesDto) {
    return this.properties.listDashboard(user.id, user.role, query);
  }
}

@ApiTags('Maintenance')
@Controller('maintenance-requests')
export class MaintenanceController {
  constructor(@Inject(DASHBOARD_SERVICE) private readonly service: IDashboardService) {}

  @Get()
  @ApiOperation({ summary: 'Liste des demandes de maintenance' })
  list(@CurrentUser() user: AuthUser, @Query() query: Record<string, unknown>) {
    return this.service.getMaintenanceRequests(user.id, user.role, query);
  }

  @Post()
  @Roles(Role.TENANT)
  @ApiOperation({ summary: 'Signaler un problème' })
  create(@CurrentUser() user: AuthUser, @Body() body: Record<string, unknown>) {
    return this.service.createMaintenanceRequest(user.id, body);
  }

  @Patch(':id')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mettre à jour une demande de maintenance' })
  update(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.service.updateMaintenanceRequest(id, body);
  }
}
