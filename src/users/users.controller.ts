import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  MethodNotAllowedException,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { StorageService } from '../storage/storage.service';
import { AdminUpdateUserDto, DelegationDto, UpdateProfileDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly service: UsersService,
    private readonly storage: StorageService,
  ) {}

  // ── Me ────────────────────────────────────────────────────────────────────

  @Get('me')
  @ApiOperation({ summary: "Profil de l'utilisateur connecté" })
  getMe(@CurrentUser() user: AuthUser) {
    return this.service.getProfile(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Mettre à jour le profil' })
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.service.updateProfile(user.id, dto);
  }

  @Post('me/avatar')
  @ApiOperation({ summary: "Upload de l'avatar" })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAvatar(@CurrentUser() user: AuthUser, @UploadedFile() file: { buffer: Buffer; mimetype: string }) {
    if (!file) throw new BadRequestException('MISSING_FILE');
    const url = await this.storage.uploadBuffer(`avatars/${user.id}`, file.buffer, file.mimetype);
    return this.service.updateAvatar(user.id, url);
  }

  // ── Admin ──────────────────────────────────────────────────────────────────

  @Post('search')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Liste paginée des utilisateurs (admin)' })
  findWithPagination(@Body() body: PaginationDto) {
    return this.service.findWithPagination(body);
  }

  @Get(':id/detail')
  @ApiOperation({ summary: "Détail d'un utilisateur — ADMIN voit tous, les autres uniquement leur propre profil" })
  findById(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    if (user.role !== Role.ADMIN && user.id !== id) {
      throw new ForbiddenException('INSUFFICIENT_PERMISSIONS');
    }
    return this.service.getUserById(id);
  }

  @Public()
  @Post('create')
  @HttpCode(HttpStatus.METHOD_NOT_ALLOWED)
  create(): never {
    throw new MethodNotAllowedException('User creation is handled by the auth module.');
  }

  @Patch(':id/update')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Modifier le rôle ou le statut d\'un utilisateur (admin)' })
  update(@Param('id') id: string, @Body() dto: AdminUpdateUserDto) {
    return this.service.adminUpdateUser(id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Désactiver un utilisateur (admin)' })
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }

  // ── Delegation ────────────────────────────────────────────────────────────

  @Post(':ownerId/delegations')
  @Roles(Role.OWNER)
  @ApiOperation({ summary: 'Déléguer des biens à un gestionnaire (sans mandat agence)' })
  delegate(@Param('ownerId') ownerId: string, @Body() dto: DelegationDto) {
    return this.service.delegate(ownerId, dto);
  }

  @Delete(':ownerId/delegations/:managerId')
  @Roles(Role.OWNER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Révoquer une délégation directe' })
  revokeDelegate(@Param('ownerId') ownerId: string, @Param('managerId') managerId: string) {
    return this.service.revokeDelegate(ownerId, managerId);
  }
}
