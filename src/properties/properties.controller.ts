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
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PropertyStatus, Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Cacheable } from '../common/decorators/cacheable.decorator';
import { CacheEvict } from '../common/decorators/cache-evict.decorator';
import { CacheInterceptor } from '../common/interceptors/cache.interceptor';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import {
  CreatePropertyDto,
  FilterPropertiesDto,
  UpdatePropertyDto,
} from './dto/create-property.dto';
import { PropertiesService } from './properties.service';

@ApiTags('Properties')
@Controller('properties')
@UseInterceptors(CacheInterceptor)
export class PropertiesController {
  constructor(private readonly service: PropertiesService) {}

  @Public()
  @Get()
  @Cacheable({ key: 'properties', ttl: 300 })
  @ApiOperation({ summary: 'Liste publique des biens' })
  listPublic(@Query() query: FilterPropertiesDto) {
    return this.service.listPublic(query);
  }

  @Public()
  @Get(':slug')
  @Cacheable({ key: 'properties', ttl: 300 })
  @ApiOperation({ summary: "Détail d'un bien (public)" })
  getBySlug(@Param('slug') slug: string) {
    return this.service.getBySlug(slug);
  }

  @Get('dashboard/list')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Liste des biens du propriétaire / manager' })
  listDashboard(@CurrentUser() user: AuthUser, @Query() query: FilterPropertiesDto) {
    return this.service.listDashboard(user.id, user.role, query);
  }

  @Post()
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @CacheEvict({ key: 'properties' })
  @ApiOperation({ summary: 'Créer un bien' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePropertyDto) {
    return this.service.createProperty(user.id, dto);
  }

  @Patch(':id')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @CacheEvict({ key: 'properties' })
  @ApiOperation({ summary: 'Modifier un bien' })
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdatePropertyDto,
  ) {
    return this.service.updateProperty(id, user.id, user.role, dto);
  }

  @Patch(':id/publish')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @CacheEvict({ key: 'properties' })
  @ApiOperation({ summary: 'Publier / dépublier un bien' })
  publish(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { isPublished: boolean },
  ) {
    return this.service.setPublished(id, user.id, user.role, body.isPublished);
  }

  @Patch(':id/status')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @CacheEvict({ key: 'properties' })
  @ApiOperation({ summary: "Changer le statut d'un bien" })
  setStatus(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { status: PropertyStatus },
  ) {
    return this.service.setStatus(id, user.id, user.role, body.status);
  }

  @Delete(':id')
  @Roles(Role.OWNER, Role.ADMIN)
  @CacheEvict({ key: 'properties' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Supprimer un bien (soft delete)' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id, user.role);
  }

  @Post(':id/images')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @CacheEvict({ key: 'properties' })
  @ApiOperation({ summary: "Upload des photos d'un bien" })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('images[]', 4))
  uploadImages(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    // TODO: replace placeholder URLs with sharp + storage service
    const placeholders = (files ?? []).map((f) => ({
      url: `https://placeholder/${f.originalname}`,
      thumbUrl: `https://placeholder/thumb-${f.originalname}`,
    }));
    return this.service.addImages(id, user.id, user.role, placeholders);
  }

  @Patch(':id/images/:imageId/cover')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @CacheEvict({ key: 'properties' })
  @ApiOperation({ summary: 'Définir la photo de couverture' })
  setCover(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.setCover(id, imageId, user.id, user.role);
  }

  @Delete(':id/images/:imageId')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @CacheEvict({ key: 'properties' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Supprimer une image' })
  removeImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.removeImage(id, imageId, user.id, user.role);
  }

  @Post(':id/documents')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: "Upload des documents d'un bien" })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('documents[]', 10))
  uploadDocuments(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: { names?: string[] },
  ) {
    const docs = (files ?? []).map((f, i) => ({
      name: (body.names && body.names[i]) || f.originalname,
      url: `https://placeholder/${f.originalname}`,
    }));
    return this.service.addDocuments(id, user.id, user.role, docs);
  }

  @Get(':id/applications')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Liste des candidatures reçues' })
  getApplications(@Param('id') _id: string) {
    return { data: [], message: 'Voir ApplicationsController' };
  }
}
