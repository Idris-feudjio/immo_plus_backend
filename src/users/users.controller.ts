import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
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

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Liste des utilisateurs (admin)' })
  override findAll(@Query() query: PaginationDto & { role?: Role; isActive?: boolean }) {
    return this.service.listUsers(query);
  }

  @Get(':id')
  @ApiOperation({ summary: "Détail d'un utilisateur" })
  override findOne(@Param('id') id: string, @CurrentUser() user?: AuthUser) {
    if (user && user.role !== Role.ADMIN && user.id !== id) {
      return this.service.getProfile(user.id);
    }
    return this.service.getUserById(id);
  }

  @Post()
  @HttpCode(HttpStatus.METHOD_NOT_ALLOWED)
  override create(): never {
    throw new HttpException('Method not allowed', HttpStatus.METHOD_NOT_ALLOWED);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Modifier un utilisateur (admin)' })
  override update(@Param('id') id: string, @Body() dto: AdminUpdateUserDto) {
    return this.service.adminUpdateUser(id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Désactiver un utilisateur (admin)' })
  override remove(@Param('id') id: string) {
    return this.service.softDeleteUser(id);
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
