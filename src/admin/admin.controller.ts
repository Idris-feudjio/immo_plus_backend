import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import type { IAdminService } from './interfaces/admin-service.interface';
import { ADMIN_SERVICE } from './interfaces/admin-service.interface';

@ApiTags('Admin')
@Controller('admin')
@Roles(Role.ADMIN)
export class AdminController {
  constructor(@Inject(ADMIN_SERVICE) private readonly service: IAdminService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Statistiques globales (admin)' })
  getStats() {
    return this.service.getGlobalStats();
  }

  @Get('settings')
  @ApiOperation({ summary: 'Paramètres système' })
  getSettings() {
    return this.service.getSettings();
  }

  @Put('settings')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Modifier les paramètres système' })
  updateSettings(@Body() body: Record<string, unknown>) {
    return this.service.updateSettings(body);
  }
}
