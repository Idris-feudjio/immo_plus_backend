import {
  Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { FilterPropertiesDto } from '../properties/dto/create-property.dto';
import { PropertiesService } from '../properties/properties.service';
import { DashboardService } from './dashboard.service';

@ApiTags('Dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly service: DashboardService,
    private readonly properties: PropertiesService,
  ) {}

  @Get('portfolio')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'KPIs de portefeuille — occupancy, revenus, paiements LATE, contrats expirants (Story 9.1)' })
  getPortfolioKPIs(@CurrentUser() user: AuthUser) {
    return this.service.getPortfolioKPIs(user.id, user.role);
  }

  @Get('maintenance')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'KPIs maintenances — open par urgence, délai moyen de résolution (Story 9.2)' })
  getMaintenanceKPIs(@CurrentUser() user: AuthUser) {
    return this.service.getMaintenanceKPIs(user.id, user.role);
  }

  @Get('commissions')
  @Roles(Role.MANAGER)
  @ApiOperation({ summary: 'KPIs commissions agence — encaissées, en attente, top 5 owners (Story 9.3)' })
  getCommissionKPIs(@CurrentUser() user: AuthUser) {
    return this.service.getCommissionKPIs(user.id);
  }

  @Get('admin')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'KPIs plateforme — utilisateurs, biens, commissions, top agences (Story 9.4)' })
  getAdminKPIs() {
    return this.service.getAdminKPIs();
  }

  @Get('stats')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Tableau de bord propriétaire / gestionnaire' })
  getStats(@CurrentUser() user: AuthUser) {
    return this.service.getOwnerStats(user.id, user.role);
  }

  @Get('tenant')
  @Roles(Role.TENANT)
  @ApiOperation({ summary: 'Espace locataire avec maintenances (Story 9.5)' })
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
  constructor(private readonly service: DashboardService) {}

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
