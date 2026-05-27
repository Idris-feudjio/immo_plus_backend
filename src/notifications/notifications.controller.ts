import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private service: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Liste des notifications' })
  list(@CurrentUser() user: any, @Query() query: { isRead?: boolean; type?: string; page?: number; limit?: number }) {
    return this.service.list(user.id, query);
  }

  @Get('count')
  @ApiOperation({ summary: 'Nombre de notifications non lues' })
  count(@CurrentUser() user: any) {
    return this.service.getCount(user.id);
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Marquer toutes comme lues' })
  markAllRead(@CurrentUser() user: any) {
    return this.service.markAllRead(user.id);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Marquer comme lue' })
  markRead(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.markRead(user.id, id);
  }

  @Get('preferences')
  @ApiOperation({ summary: 'Préférences de notification' })
  getPrefs(@CurrentUser() user: any) {
    return this.service.getPreferences(user.id);
  }

  @Put('preferences')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mettre à jour les préférences' })
  updatePrefs(@CurrentUser() user: any, @Body() body: any) {
    return this.service.updatePreferences(user.id, body);
  }

  @Put('payment-alerts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Configurer les alertes de paiement' })
  upsertAlerts(@CurrentUser() user: any, @Body() body: any) {
    return this.service.upsertPaymentAlerts(user.id, body);
  }
}
