import { Body, Controller, Get, HttpCode, HttpStatus, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { AdminService } from './admin.service';

@ApiTags('Admin')
@Controller('admin')
@Roles(Role.ADMIN)
export class AdminController {
  constructor(private service: AdminService) {}

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
  updateSettings(@Body() body: any) {
    return this.service.updateSettings(body);
  }
}
