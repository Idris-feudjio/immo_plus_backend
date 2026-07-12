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
import { SearchRequestDto } from '../common/dto/pagination.dto';
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

  @Get('profile')
  @ApiOperation({ summary: "Profil de l'utilisateur connecté" })
  getMe(@CurrentUser() user: AuthUser) {
    return this.service.findByIdOrThrow(user.id);
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Mettre à jour le profil' })
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.service.update(user.id, dto);
  }

  @Post('profile/avatar')
  @ApiOperation({ summary: "Upload de l'avatar" })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  async uploadAvatar(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('MISSING_FILE');

    const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
    if (!ALLOWED_TYPES.includes(file.mimetype)) throw new BadRequestException('INVALID_FILE_TYPE');
    if (file.buffer.length > 2 * 1024 * 1024) throw new BadRequestException('FILE_TOO_LARGE');

    const currentUser = await this.service.findByIdOrThrow(user.id);
    if (currentUser.avatarUrl) {
      const oldKey = this.storage.keyFromUrl(currentUser.avatarUrl);
      await this.storage.delete(oldKey);
    }

    const extMap: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
    const key = `users/${user.id}/avatar.${extMap[file.mimetype]}`;
    const url = await this.storage.uploadBuffer(key, file.buffer, file.mimetype);
    return this.service.updateAvatar(user.id, url);
  }

  // ── Admin ──────────────────────────────────────────────────────────────────

  @Post('search/all')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Liste paginée des utilisateurs (admin)' })
  findWithPagination(@Body() body: SearchRequestDto) {
    return this.service.findWithPagination(body);
  }

  @Post('search')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Liste complète des utilisateurs sans pagination (admin)' })
  findAll(@Body() body: SearchRequestDto) {
    return this.service.findAll(body);
  }

  @Get(':id/detail')
  @ApiOperation({ summary: "Détail d'un utilisateur — ADMIN voit tous, les autres uniquement leur propre profil" })
  findById(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    if (user.role !== Role.ADMIN && user.id !== id) {
      throw new ForbiddenException('INSUFFICIENT_PERMISSIONS');
    }
    return this.service.findByIdOrThrow(id);
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
    return this.service.update(id, dto);
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
