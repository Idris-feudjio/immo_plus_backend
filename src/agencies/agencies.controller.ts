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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { SearchRequestDto } from '../common/dto/pagination.dto';
import { AddAgencyMemberDto, CreateAgencyDto } from './dto/agency.dto';
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
    return this.service.createAgency(dto);
  }

  @Patch(':id/suspend')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspend an agency (ADMIN only)' })
  suspend(@Param('id') id: string) {
    return this.service.suspend(id);
  }

  @Post('search')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List agencies with member count (ADMIN only)' })
  search(@Body() body: SearchRequestDto) {
    return this.service.search(body);
  }

  @Post(':id/members')
  @Roles(Role.ADMIN, Role.MANAGER)
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
  @Roles(Role.ADMIN, Role.MANAGER)
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
