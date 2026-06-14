import {
  Body,
  Controller,
  Delete,
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
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { AddAgencyMemberDto, CreateAgencyDto, ListAgenciesDto } from './dto/agency.dto';
import { AgenciesService } from './agencies.service';

@ApiTags('Agencies')
@Controller('agencies')
export class AgenciesController {
  constructor(private readonly service: AgenciesService) {}

  @Post()
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new agency (ADMIN only)' })
  create(@Body() dto: CreateAgencyDto) {
    return this.service.create(dto);
  }

  @Patch(':id/suspend')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspend an agency (ADMIN only)' })
  suspend(@Param('id') id: string) {
    return this.service.suspend(id);
  }

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'List agencies with member count (ADMIN only)' })
  list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const query: ListAgenciesDto = {
      page: page !== undefined ? parseInt(page, 10) : undefined,
      limit: limit !== undefined ? parseInt(limit, 10) : undefined,
    };
    return this.service.list(query);
  }

  @Post(':id/members')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a member to an agency' })
  addMember(
    @Param('id') agencyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: AddAgencyMemberDto,
  ) {
    return this.service.addMember(agencyId, user.id, user.role, dto);
  }

  @Delete(':id/members/:memberId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a member from an agency' })
  async removeMember(
    @Param('id') agencyId: string,
    @Param('memberId') memberId: string,
  ) {
    await this.service.removeMember(agencyId, memberId);
  }

  @Public()
  @Get(':id/public')
  @ApiOperation({ summary: 'Get public agency profile (no auth required)' })
  getPublicProfile(@Param('id') id: string) {
    return this.service.getPublicProfile(id);
  }
}
