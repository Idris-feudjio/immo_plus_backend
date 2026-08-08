import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { SearchRequestDto } from '../common/dto/pagination.dto';
import {
  CreateContractDto,
  RenewContractDto,
  TerminateContractDto,
} from './dto/contract.dto';
import { ContractsService } from './contracts.service';

@ApiTags('Contracts')
@Controller('contracts')
export class ContractsController {
  constructor(private readonly service: ContractsService) {}

  @Post('search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liste des contrats' })
  search(@CurrentUser() user: AuthUser, @Body() body: SearchRequestDto) {
    return this.service.search(user.id, user.role, body);
  }

  @Post()
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Créer un contrat' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateContractDto) {
    return this.service.createContract(user.id, user.role, dto);
  }

  @Public()
  @Get('accept/:token')
  @ApiOperation({ summary: "Résumé d'un contrat en attente de signature" })
  getAcceptanceSummary(@Param('token') token: string) {
    return this.service.getAcceptanceSummary(token);
  }

  @Public()
  @Post('accept/:token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accepter un contrat via le lien de signature' })
  acceptContract(@Param('token') token: string, @Req() req: Request) {
    const forwarded = (req.headers['x-forwarded-for'] as string | undefined)
      ?.split(',')[0]
      ?.trim();
    const ip = forwarded || req.ip || 'unknown';
    return this.service.acceptContract(token, ip);
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
  renew(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: RenewContractDto,
  ) {
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
    @Query('lang') lang?: string,
    @Query('force') force?: string,
  ) {
    const resolvedLang = lang === 'en' ? 'en' : 'fr';
    return this.service.getPdfUrl(
      id,
      user.id,
      user.role,
      resolvedLang,
      force === 'true',
    );
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
