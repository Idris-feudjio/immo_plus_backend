import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { AdminService } from './admin.service';

@ApiTags('Admin')
@Controller('admin')
@Roles(Role.ADMIN)
export class AdminController {
  constructor(private readonly service: AdminService) {}

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

  @Get('users')
  @ApiOperation({ summary: 'Liste paginée des utilisateurs (admin)' })
  listUsers(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('role') role?: Role,
    @Query('isActive') isActive?: string,
    @Query('search') search?: string,
  ) {
    return this.service.listUsers({
      page: page !== undefined ? parseInt(page, 10) : undefined,
      limit: limit !== undefined ? parseInt(limit, 10) : undefined,
      role,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      search,
    });
  }

  @Patch('users/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Désactiver un utilisateur' })
  deactivateUser(@Param('id') id: string) {
    return this.service.deactivateUser(id);
  }
}
