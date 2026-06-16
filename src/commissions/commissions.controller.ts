import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { PaginationDto } from '../common/dto/pagination.dto';
import { CreateCommissionDto, PayCommissionDto } from './dto/commission.dto';
import { CommissionsService } from './commissions.service';

@ApiTags('commissions')
@Controller('commissions')
export class CommissionsController {
  constructor(private readonly service: CommissionsService) {}

  @Get('dashboard')
  @Roles(Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Tableau de bord commissions (MANAGER | ADMIN)' })
  getDashboard(@CurrentUser() user: AuthUser) {
    return this.service.getDashboard(user.id, user.role);
  }

  @Get('my-due')
  @Roles(Role.OWNER)
  @ApiOperation({ summary: 'Mes commissions dues (OWNER)' })
  getMyDue(@CurrentUser() user: AuthUser) {
    return this.service.getMyDue(user.id);
  }

  @Post('search')
  @Roles(Role.MANAGER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liste des commissions (MANAGER | ADMIN)' })
  search(@CurrentUser() user: AuthUser, @Body() body: PaginationDto) {
    return this.service.search(user.id, user.role, body);
  }

  @Post()
  @Roles(Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Créer une commission manuelle (PLACEMENT ou EXCEPTIONAL)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCommissionDto) {
    return this.service.createCommission(user.id, user.role, dto);
  }

  @Post(':id/pay')
  @Roles(Role.OWNER, Role.ADMIN)
  @ApiOperation({ summary: 'Marquer une commission comme payée (OWNER | ADMIN)' })
  pay(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: PayCommissionDto,
  ) {
    return this.service.pay(id, user.id, user.role, dto);
  }

  @Post(':id/cancel')
  @Roles(Role.OWNER, Role.ADMIN)
  @ApiOperation({ summary: 'Annuler une commission PENDING (OWNER | ADMIN)' })
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.cancel(id, user.id, user.role);
  }
}
