import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { SearchRequestDto } from '../common/dto/pagination.dto';
import {
  CreatePaymentDto,
  SendRemindersDto,
  UpdatePaymentDto,
} from './dto/payment.dto';
import { PaymentsService } from './payments.service';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  @Post('search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liste des paiements' })
  search(@CurrentUser() user: AuthUser, @Body() body: SearchRequestDto) {
    return this.service.search(user.id, user.role, body);
  }

  @Post()
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Enregistrer un paiement' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePaymentDto) {
    return this.service.createPayment(user.id, user.role, dto);
  }

  @Patch(':id')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Modifier un paiement' })
  update(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: UpdatePaymentDto) {
    return this.service.updatePayment(id, user.id, user.role, dto);
  }

  @Get('overdue')
  @ApiOperation({ summary: 'Tableau de bord des impayés' })
  getOverdue(@CurrentUser() user: AuthUser) {
    return this.service.getOverdue(user.id, user.role);
  }

  @Post('reminders')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Envoyer des rappels' })
  sendReminders(@CurrentUser() user: AuthUser, @Body() dto: SendRemindersDto) {
    return this.service.sendReminders(user.id, user.role, dto);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Statistiques de paiement' })
  getStats(
    @CurrentUser() user: AuthUser,
    @Query() query: { year?: number; month?: number; propertyId?: string },
  ) {
    return this.service.getStats(user.id, user.role, query);
  }

  @Get(':id/receipt')
  @ApiOperation({ summary: "Quittance d'un paiement" })
  getReceipt(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.getReceiptUrl(id, user.id, user.role);
  }
}
