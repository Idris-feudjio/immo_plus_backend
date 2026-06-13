import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import {
  CreateContractDto,
  FilterContractsDto,
  RenewContractDto,
  TerminateContractDto,
} from './dto/contract.dto';
import type { IContractsService } from './interfaces/contracts-service.interface';
import { CONTRACTS_SERVICE } from './interfaces/contracts-service.interface';

@ApiTags('Contracts')
@Controller('contracts')
export class ContractsController {
  constructor(@Inject(CONTRACTS_SERVICE) private readonly service: IContractsService) {}

  @Get()
  @ApiOperation({ summary: 'Liste des contrats' })
  list(@CurrentUser() user: AuthUser, @Query() query: FilterContractsDto) {
    return this.service.list(user.id, user.role, query);
  }

  @Post()
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Créer un contrat' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateContractDto) {
    return this.service.create(user.id, user.role, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: "Détail d'un contrat" })
  getOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.getById(id, user.id, user.role);
  }

  @Post(':id/renewal')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Renouveler un contrat' })
  renew(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: RenewContractDto) {
    return this.service.renew(id, user.id, user.role, dto);
  }

  @Post(':id/termination')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Résilier un contrat' })
  terminate(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: TerminateContractDto,
  ) {
    return this.service.terminate(id, user.id, user.role, dto);
  }

  @Get(':id/pdf')
  @ApiOperation({ summary: 'Télécharger le PDF du contrat' })
  getPdf(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Query('force') force?: string,
  ) {
    return this.service.getPdfUrl(id, user.id, user.role, force === 'true');
  }

  @Post(':id/receipts')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Générer les quittances' })
  generateReceipts(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { period: string },
  ) {
    return this.service.generateReceipts(id, user.id, user.role, body.period);
  }
}
