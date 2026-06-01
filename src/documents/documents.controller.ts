import {
  Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import type { IDocumentsService } from './interfaces/documents-service.interface';
import { DOCUMENTS_SERVICE } from './interfaces/documents-service.interface';

@ApiTags('Reports')
@Controller('reports')
export class DocumentsController {
  constructor(@Inject(DOCUMENTS_SERVICE) private readonly service: IDocumentsService) {}

  @Get('financial')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Rapport financier' })
  financial(
    @CurrentUser() user: AuthUser,
    @Query() query: { startDate?: string; endDate?: string; propertyId?: string },
  ) {
    return this.service.getFinancialReport(user.id, user.role, query);
  }

  @Get('occupancy')
  @ApiOperation({ summary: "Taux d'occupation" })
  occupancy(
    @CurrentUser() user: AuthUser,
    @Query() query: { year?: number; propertyId?: string },
  ) {
    return this.service.getOccupancyReport(user.id, user.role, query);
  }

  @Post('export')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Exporter un rapport PDF (asynchrone)' })
  createExport(
    @CurrentUser() user: AuthUser,
    @Body() body: { type: string; startDate?: string; endDate?: string; propertyId?: string },
  ) {
    return this.service.createExportJob(user.id, body);
  }

  @Get('export/:jobId')
  @ApiOperation({ summary: "Statut d'un export PDF" })
  getExport(@Param('jobId') jobId: string) {
    return this.service.getExportStatus(jobId);
  }

  @Get('profitability/:propertyId')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Analyse de rentabilité' })
  profitability(
    @Param('propertyId') propertyId: string,
    @CurrentUser() user: AuthUser,
    @Query() query: { startDate?: string; endDate?: string },
  ) {
    return this.service.getProfitability(propertyId, user.id, user.role, query);
  }
}
