import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ApplicationStatus, Role } from '@prisma/client';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { TurnstileGuard } from '../common/guards/turnstile.guard.js';
import { SearchRequestDto } from '../common/dto/pagination.dto';
import { ApplicationsService, SubmitApplicationDto } from './applications.service';

@ApiTags('Applications')
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly service: ApplicationsService) {}

  @Post()
  @Public()
  @UseGuards(TurnstileGuard)
  @Throttle({ default: { limit: 5, ttl: 3600000 } })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Soumettre une candidature locative (public)' })
  submit(@Body() dto: SubmitApplicationDto) {
    return this.service.submit(dto);
  }

  @Post('search')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lister les candidatures d\'un bien (Owner/Manager/Admin)' })
  search(@CurrentUser() user: AuthUser, @Body() body: SearchRequestDto) {
    return this.service.search(user, body);
  }

  @Patch(':id/accept')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accepter une candidature' })
  accept(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.updateStatus(user, id, ApplicationStatus.ACCEPTED);
  }

  @Patch(':id/reject')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rejeter une candidature' })
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.updateStatus(user, id, ApplicationStatus.REJECTED);
  }
}
