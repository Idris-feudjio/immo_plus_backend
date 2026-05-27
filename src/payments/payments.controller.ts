import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CreatePaymentDto,
  FilterPaymentsDto,
  SendRemindersDto,
  UpdatePaymentDto,
} from './dto/payment.dto';
import { PaymentsService } from './payments.service';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private service: PaymentsService) {}

  @Get()
  @ApiOperation({ summary: 'Liste des paiements' })
  list(@CurrentUser() user: any, @Query() query: FilterPaymentsDto) {
    return this.service.list(user.id, user.role, query);
  }

  @Post()
  @Roles(Role.owner, Role.manager, Role.admin)
  @ApiOperation({ summary: 'Enregistrer un paiement' })
  create(@CurrentUser() user: any, @Body() dto: CreatePaymentDto) {
    return this.service.create(user.id, user.role, dto);
  }

  @Patch(':id')
  @Roles(Role.owner, Role.manager, Role.admin)
  @ApiOperation({ summary: 'Modifier un paiement' })
  update(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: UpdatePaymentDto) {
    return this.service.update(id, user.id, user.role, dto);
  }

  @Get('overdue')
  @ApiOperation({ summary: 'Tableau de bord des impayés' })
  getOverdue(@CurrentUser() user: any) {
    return this.service.getOverdue(user.id, user.role);
  }

  @Post('reminders')
  @Roles(Role.owner, Role.manager, Role.admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Envoyer des rappels' })
  sendReminders(@CurrentUser() user: any, @Body() dto: SendRemindersDto) {
    return this.service.sendReminders(user.id, user.role, dto);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Statistiques de paiement' })
  getStats(
    @CurrentUser() user: any,
    @Query() query: { year?: number; month?: number; propertyId?: string },
  ) {
    return this.service.getStats(user.id, user.role, query);
  }

  @Get(':id/receipt')
  @ApiOperation({ summary: 'Quittance d\'un paiement' })
  getReceipt(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.getReceiptUrl(id, user.id, user.role);
  }
}
