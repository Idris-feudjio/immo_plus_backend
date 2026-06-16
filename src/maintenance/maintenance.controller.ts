import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { SearchRequestDto } from '../common/dto/pagination.dto';
import { CreateMaintenanceDto, UpdateMaintenanceStatusDto } from './dto/maintenance.dto';
import { MaintenanceService } from './maintenance.service';

@ApiTags('Maintenance')
@Controller('maintenance')
export class MaintenanceController {
  constructor(private readonly service: MaintenanceService) {}

  // ── Story 6.4: Tenant view (must come before :id routes) ─────────────────────

  @Get('my-requests')
  @Roles(Role.TENANT)
  @ApiOperation({ summary: 'Mes demandes de maintenance (locataire)' })
  getMyRequests(@CurrentUser() user: AuthUser) {
    return this.service.getMyRequests(user.id);
  }

  // ── Story 6.3: List with filters ─────────────────────────────────────────────

  @Post('search')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liste des demandes de maintenance' })
  search(@CurrentUser() user: AuthUser, @Body() body: SearchRequestDto) {
    return this.service.search(user, body);
  }

  // ── Story 6.1: Create ─────────────────────────────────────────────────────────

  @Post()
  @Roles(Role.TENANT, Role.OWNER, Role.MANAGER, Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Créer une demande de maintenance' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateMaintenanceDto) {
    return this.service.createRequest(user, dto);
  }

  // ── Story 6.2: Update status ──────────────────────────────────────────────────

  @Patch(':id/status')
  @Roles(Role.TENANT, Role.OWNER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Mettre à jour le statut d\'une demande de maintenance' })
  updateStatus(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateMaintenanceStatusDto,
  ) {
    return this.service.updateStatus(user, id, dto);
  }

  // ── Story 6.5: Photo upload ───────────────────────────────────────────────────

  @Post(':id/photos')
  @Roles(Role.TENANT, Role.OWNER, Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Ajouter des photos à une demande de maintenance' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('photos[]', 3))
  addPhotos(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.service.addPhotos(user, id, files);
  }
}
