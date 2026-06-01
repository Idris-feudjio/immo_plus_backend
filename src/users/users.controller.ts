import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { AdminUpdateUserDto, DelegationDto, UpdateProfileDto } from './dto/update-user.dto';
import type { IUsersService } from './interfaces/users-service.interface';
import { USERS_SERVICE } from './interfaces/users-service.interface';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(@Inject(USERS_SERVICE) private readonly users: IUsersService) {}

  @Get('me')
  @ApiOperation({ summary: "Profil de l'utilisateur connecté" })
  getMe(@CurrentUser() user: AuthUser) {
    return this.users.getProfile(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Mettre à jour le profil' })
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(user.id, dto);
  }

  @Post('me/avatar')
  @ApiOperation({ summary: "Upload de l'avatar" })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  uploadAvatar(@CurrentUser() user: AuthUser, @UploadedFile() _file: Express.Multer.File) {
    // TODO: upload to storage and get URL
    return this.users.updateAvatar(user.id, 'placeholder-url');
  }

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Liste des utilisateurs (admin)' })
  list(@Query() query: PaginationDto & { role?: Role; search?: string; isActive?: boolean }) {
    return this.users.listUsers(query);
  }

  @Get(':id')
  @ApiOperation({ summary: "Détail d'un utilisateur" })
  getOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    if (user.role !== Role.ADMIN && user.id !== id) {
      return this.users.getProfile(user.id);
    }
    return this.users.getUserById(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Modifier un utilisateur (admin)' })
  adminUpdate(@Param('id') id: string, @Body() dto: AdminUpdateUserDto) {
    return this.users.adminUpdateUser(id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Désactiver un utilisateur (admin)' })
  remove(@Param('id') id: string) {
    return this.users.softDeleteUser(id);
  }

  @Post(':ownerId/delegations')
  @Roles(Role.OWNER)
  @ApiOperation({ summary: 'Déléguer des biens à un gestionnaire' })
  delegate(@Param('ownerId') ownerId: string, @Body() dto: DelegationDto) {
    return this.users.delegate(ownerId, dto);
  }

  @Delete(':ownerId/delegations/:managerId')
  @Roles(Role.OWNER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Révoquer une délégation' })
  revokeDelegate(@Param('ownerId') ownerId: string, @Param('managerId') managerId: string) {
    return this.users.revokeDelegate(ownerId, managerId);
  }
}
