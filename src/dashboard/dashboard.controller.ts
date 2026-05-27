import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';
import { FilterPropertiesDto } from '../properties/dto/create-property.dto';
import { PropertiesService } from '../properties/properties.service';

@ApiTags('Dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(
    private service: DashboardService,
    private properties: PropertiesService,
  ) {}

  @Get('stats')
   @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Tableau de bord propriétaire / gestionnaire' })
  getStats(@CurrentUser() user: any) {
    return this.service.getOwnerStats(user.id, user.role);
  }

  @Get('tenant')
  @Roles(Role.TENANT)
  @ApiOperation({ summary: 'Espace locataire' })
  getTenantDashboard(@CurrentUser() user: any) {
    return this.service.getTenantDashboard(user.id);
  }

  @Get('properties')
   @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Biens du dashboard (avec non publiés)' })
  getProperties(@CurrentUser() user: any, @Query() query: FilterPropertiesDto) {
    return this.properties.listDashboard(user.id, user.role, query);
  }
}

@ApiTags('Maintenance')
@Controller('maintenance-requests')
export class MaintenanceController {
  constructor(private service: DashboardService) {}

  @Get()
  @ApiOperation({ summary: 'Liste des demandes de maintenance' })
  list(@CurrentUser() user: any, @Query() query: any) {
    return this.service.getMaintenanceRequests(user.id, user.role, query);
  }

  @Post()
  @Roles(Role.TENANT)
  @ApiOperation({ summary: 'Signaler un problème' })
  create(@CurrentUser() user: any, @Body() body: any) {
    return this.service.createMaintenanceRequest(user.id, body);
  }

  @Patch(':id')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mettre à jour une demande de maintenance' })
  update(@Param('id') id: string, @Body() body: any) {
    return this.service.updateMaintenanceRequest(id, body);
  }
}
