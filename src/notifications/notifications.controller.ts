import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { SearchRequestDto } from '../common/dto/pagination.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Post('search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liste des notifications' })
  search(@CurrentUser() user: AuthUser, @Body() body: SearchRequestDto) {
    return this.service.search(user.id, body);
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
