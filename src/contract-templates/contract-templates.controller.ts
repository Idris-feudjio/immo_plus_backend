import {
  Body,
  Controller,
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
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { SearchRequestDto } from '../common/dto/pagination.dto';
import {
  CreateContractTemplateDto,
  UpdateContractTemplateDto,
} from './dto/contract-template.dto';
import { ContractTemplatesService } from './contract-templates.service';

@ApiTags('Contract Templates')
@Controller('contract-templates')
export class ContractTemplatesController {
  constructor(private readonly service: ContractTemplatesService) {}

  @Post()
  @Roles(Role.MANAGER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Créer un modèle de contrat pour l'agence" })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateContractTemplateDto,
  ) {
    return this.service.createTemplate(user.id, dto);
  }

  @Post('search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Lister les modèles de contrat de l'agence" })
  search(@CurrentUser() user: AuthUser, @Body() body: SearchRequestDto) {
    return this.service.search(user.id, user.role, body);
  }

  @Get(':id')
  @ApiOperation({ summary: "Détail d'un modèle de contrat" })
  getOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.getOneScoped(id, user.id, user.role);
  }

  @Patch(':id')
  @Roles(Role.MANAGER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Modifier un modèle de contrat' })
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateContractTemplateDto,
  ) {
    return this.service.updateTemplate(id, user.id, user.role, dto);
  }
}
