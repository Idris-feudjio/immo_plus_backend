import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import type { ICommissionService } from './interfaces/commission-service.interface';
import { COMMISSION_SERVICE } from './interfaces/commission-service.interface';
import { CreateCommissionDto, FilterCommissionsDto, PayCommissionDto } from './dto/commission.dto';

@ApiTags('commissions')
@Controller('commissions')
export class CommissionsController {
  constructor(
    @Inject(COMMISSION_SERVICE)
    private readonly service: ICommissionService,
  ) {}

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

  @Get()
  @Roles(Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Liste des commissions (MANAGER | ADMIN)' })
  list(@CurrentUser() user: AuthUser, @Query() query: FilterCommissionsDto) {
    return this.service.list(user.id, user.role, query);
  }

  @Post()
  @Roles(Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Créer une commission manuelle (PLACEMENT ou EXCEPTIONAL)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCommissionDto) {
    return this.service.create(user.id, user.role, dto);
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
