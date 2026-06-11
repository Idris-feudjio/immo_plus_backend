import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, User } from '@prisma/client';
import { BaseController } from '../common/abstractions/base.controller';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { AdminUpdateUserDto, DelegationDto, UpdateProfileDto } from './dto/update-user.dto';
import { UserCreateData } from './user.repository';
import { UsersService } from './users.service';

@ApiTags('Users')
@Controller('users')
export class UsersController extends BaseController<User, UserCreateData> {
  constructor(protected override readonly service: UsersService) {
    super(service);
  }

  // ── Me routes ──────────────────────────────────────────────────────────────

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
  uploadAvatar(@CurrentUser() user: AuthUser, @UploadedFile() _file: Express.Multer.File) {
    // TODO: upload to storage and get URL
    return this.service.updateAvatar(user.id, 'placeholder-url');
  }

  // ── Overrides ──────────────────────────────────────────────────────────────

  @Post('search')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Liste des utilisateurs (admin)' })
  override findWithPagination(@Body() body: PaginationDto) {
    return this.service.findWithPagination(body);
  }

  @Get(':id/detail')
  @ApiOperation({ summary: "Détail d'un utilisateur" })
  override findById(@Param('id') id: string, @CurrentUser() user?: AuthUser) {
    if (user && user.role !== Role.ADMIN && user.id !== id) {
      return this.service.getProfile(user.id);
    }
    return this.service.getUserById(id);
  }

  @Post('create')
  @HttpCode(HttpStatus.METHOD_NOT_ALLOWED)
  override create(): never {
    throw new Error('User creation is handled by the auth module.');
  }

  @Patch(':id/update')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Modifier un utilisateur (admin)' })
  override update(@Param('id') id: string, @Body() dto: AdminUpdateUserDto) {
    return this.service.adminUpdateUser(id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Désactiver un utilisateur (admin)' })
  override delete(@Param('id') id: string) {
    return this.service.delete(id);
  }

  // ── Domain routes ──────────────────────────────────────────────────────────

  @Post(':ownerId/delegations')
  @Roles(Role.OWNER)
  @ApiOperation({ summary: 'Déléguer des biens à un gestionnaire' })
  delegate(@Param('ownerId') ownerId: string, @Body() dto: DelegationDto) {
    return this.service.delegate(ownerId, dto);
  }

  @Delete(':ownerId/delegations/:managerId')
  @Roles(Role.OWNER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Révoquer une délégation' })
  revokeDelegate(@Param('ownerId') ownerId: string, @Param('managerId') managerId: string) {
    return this.service.revokeDelegate(ownerId, managerId);
  }
}
