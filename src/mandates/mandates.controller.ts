import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { SearchRequestDto } from '../common/dto/pagination.dto';
import { CreateMandateDto, TerminateMandateDto } from './dto/mandate.dto';
import { MandatesService } from './mandates.service';

@ApiTags('Mandates')
@Controller('mandates')
export class MandatesController {
  constructor(private readonly service: MandatesService) {}

  @Post()
  @Roles(Role.OWNER, Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a mandate' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateMandateDto) {
    return this.service.createMandate(user.id, user.role, dto);
  }

  @Post(':id/terminate')
  @Roles(Role.OWNER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Terminate a mandate' })
  terminate(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: TerminateMandateDto,
  ) {
    return this.service.terminate(id, user.id, user.role, dto);
  }

  @Post('search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List mandates (filtered by role)' })
  search(@CurrentUser() user: AuthUser, @Body() body: SearchRequestDto) {
    const baseWhere =
      user.role === Role.ADMIN
        ? {}
        : user.role === Role.MANAGER
          ? { managerId: user.id }
          : { property: { ownerId: user.id } };
    return this.service.findWithPagination(body, baseWhere);
  }
}
