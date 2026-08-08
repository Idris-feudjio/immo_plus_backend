import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { PlansService } from './plans.service';

@ApiTags('Plans')
@Controller('plans')
export class PlansController {
  constructor(private readonly service: PlansService) {}

  @Get('me/subscription')
  @ApiOperation({
    summary:
      "Résumé de l'abonnement de l'utilisateur connecté (bannière d'essai)",
  })
  getMySubscription(@CurrentUser() user: AuthUser) {
    return this.service.getMySubscriptionSummary(user.id);
  }
}
