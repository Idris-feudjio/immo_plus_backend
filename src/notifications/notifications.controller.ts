import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import type { INotificationsService } from './interfaces/notification-service.interface';
import { NOTIFICATIONS_SERVICE } from './interfaces/notification-service.interface';

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(
    @Inject(NOTIFICATIONS_SERVICE) private readonly service: INotificationsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Liste des notifications' })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: { isRead?: boolean; type?: string; page?: number; limit?: number },
  ) {
    return this.service.list(user.id, query);
  }

  @Get('count')
  @ApiOperation({ summary: 'Nombre de notifications non lues' })
  count(@CurrentUser() user: AuthUser) {
    return this.service.getCount(user.id);
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Marquer toutes comme lues' })
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.service.markAllRead(user.id);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Marquer comme lue' })
  markRead(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.markRead(user.id, id);
  }

  @Get('preferences')
  @ApiOperation({ summary: 'Préférences de notification' })
  getPrefs(@CurrentUser() user: AuthUser) {
    return this.service.getPreferences(user.id);
  }

  @Put('preferences')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mettre à jour les préférences' })
  updatePrefs(
    @CurrentUser() user: AuthUser,
    @Body() body: { email?: Record<string, boolean>; sms?: Record<string, boolean> },
  ) {
    return this.service.updatePreferences(user.id, body);
  }

  @Put('payment-alerts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Configurer les alertes de paiement' })
  upsertAlerts(@CurrentUser() user: AuthUser, @Body() body: Record<string, unknown>) {
    return this.service.upsertPaymentAlerts(user.id, body);
  }
}
