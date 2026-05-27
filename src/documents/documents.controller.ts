import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { DocumentsService } from './documents.service';

@ApiTags('Reports')
@Controller('reports')
export class DocumentsController {
  constructor(private service: DocumentsService) {}

  @Get('financial')
  @Roles(Role.owner, Role.manager, Role.admin)
  @ApiOperation({ summary: 'Rapport financier' })
  financial(
    @CurrentUser() user: any,
    @Query() query: { startDate?: string; endDate?: string; propertyId?: string },
  ) {
    return this.service.getFinancialReport(user.id, user.role, query);
  }

  @Get('occupancy')
  @ApiOperation({ summary: 'Taux d\'occupation' })
  occupancy(
    @CurrentUser() user: any,
    @Query() query: { year?: number; propertyId?: string },
  ) {
    return this.service.getOccupancyReport(user.id, user.role, query);
  }

  @Post('export')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Exporter un rapport PDF (asynchrone)' })
  createExport(
    @CurrentUser() user: any,
    @Body() body: { type: string; startDate?: string; endDate?: string; propertyId?: string },
  ) {
    return this.service.createExportJob(user.id, body);
  }

  @Get('export/:jobId')
  @ApiOperation({ summary: 'Statut d\'un export PDF' })
  getExport(@Param('jobId') jobId: string) {
    return this.service.getExportStatus(jobId);
  }

  @Get('profitability/:propertyId')
  @Roles(Role.owner, Role.manager, Role.admin)
  @ApiOperation({ summary: 'Analyse de rentabilité' })
  profitability(
    @Param('propertyId') propertyId: string,
    @CurrentUser() user: any,
    @Query() query: { startDate?: string; endDate?: string },
  ) {
    return this.service.getProfitability(propertyId, user.id, user.role, query);
  }
}
