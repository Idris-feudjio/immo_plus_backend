import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CreateContractDto,
  FilterContractsDto,
  RenewContractDto,
  TerminateContractDto,
} from './dto/contract.dto';
import { ContractsService } from './contracts.service';

@ApiTags('Contracts')
@Controller('contracts')
export class ContractsController {
  constructor(private service: ContractsService) {}

  @Get()
  @ApiOperation({ summary: 'Liste des contrats' })
  list(@CurrentUser() user: any, @Query() query: FilterContractsDto) {
    return this.service.list(user.id, user.role, query);
  }

  @Post()
  @Roles(Role.owner, Role.manager, Role.admin)
  @ApiOperation({ summary: 'Créer un contrat' })
  create(@CurrentUser() user: any, @Body() dto: CreateContractDto) {
    return this.service.create(user.id, user.role, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail d\'un contrat' })
  getOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.getById(id, user.id, user.role);
  }

  @Post(':id/renewal')
  @Roles(Role.owner, Role.manager, Role.admin)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Renouveler un contrat' })
  renew(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: RenewContractDto) {
    return this.service.renew(id, user.id, user.role, dto);
  }

  @Post(':id/termination')
  @Roles(Role.owner, Role.manager, Role.admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Résilier un contrat' })
  terminate(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: TerminateContractDto) {
    return this.service.terminate(id, user.id, user.role, dto);
  }

  @Get(':id/pdf')
  @ApiOperation({ summary: 'Télécharger le PDF du contrat' })
  getPdf(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.getPdfUrl(id, user.id, user.role);
  }

  @Post(':id/receipts')
  @Roles(Role.owner, Role.manager, Role.admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Générer les quittances' })
  generateReceipts(@Param('id') id: string, @CurrentUser() user: any, @Body() body: { period: string }) {
    return this.service.generateReceipts(id, user.id, user.role, body.period);
  }
}
