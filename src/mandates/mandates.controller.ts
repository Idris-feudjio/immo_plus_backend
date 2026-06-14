import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MandateStatus } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { CreateMandateDto, ListMandatesDto, TerminateMandateDto } from './dto/mandate.dto';
import { MandatesService } from './mandates.service';

@ApiTags('Mandates')
@Controller('mandates')
export class MandatesController {
  constructor(private readonly service: MandatesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a mandate' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateMandateDto) {
    return this.service.create(user.id, user.role, dto);
  }

  @Post(':id/terminate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Terminate a mandate' })
  terminate(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: TerminateMandateDto,
  ) {
    return this.service.terminate(id, user.id, user.role, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List mandates (filtered by role)' })
  list(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: MandateStatus,
    @Query('propertyId') propertyId?: string,
    @Query('agencyId') agencyId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const query: ListMandatesDto = {
      status,
      propertyId,
      agencyId,
      page: page !== undefined ? parseInt(page, 10) : undefined,
      limit: limit !== undefined ? parseInt(limit, 10) : undefined,
    };
    return this.service.list(user.id, user.role, query);
  }
}
