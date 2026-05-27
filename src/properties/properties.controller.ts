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
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CreatePropertyDto,
  FilterPropertiesDto,
  UpdatePropertyDto,
} from './dto/create-property.dto';
import { PropertiesService } from './properties.service';

@ApiTags('Properties')
@Controller('properties')
export class PropertiesController {
  constructor(private service: PropertiesService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liste publique des biens' })
  listPublic(@Query() query: FilterPropertiesDto) {
    return this.service.listPublic(query);
  }

  @Public()
  @Get(':slug')
  @ApiOperation({ summary: 'Détail d\'un bien (public)' })
  getBySlug(@Param('slug') slug: string) {
    return this.service.getBySlug(slug);
  }

  @Post()
   @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Créer un bien' })
  create(@CurrentUser() user: any, @Body() dto: CreatePropertyDto) {
    return this.service.create(user.id, dto);
  }

  @Patch(':id')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Modifier un bien' })
  update(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: UpdatePropertyDto) {
    return this.service.update(id, user.id, user.role, dto);
  }

  @Patch(':id/publish')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Publier / dépublier un bien' })
  publish(@Param('id') id: string, @CurrentUser() user: any, @Body() body: { isPublished: boolean }) {
    return this.service.setPublished(id, user.id, user.role, body.isPublished);
  }

  @Patch(':id/status')
   @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Changer le statut d\'un bien' })
  setStatus(@Param('id') id: string, @CurrentUser() user: any, @Body() body: { status: any }) {
    return this.service.setStatus(id, user.id, user.role, body.status);
  }

  @Delete(':id')
  @Roles(Role.OWNER, Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Supprimer un bien (soft delete)' })
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.remove(id, user.id, user.role);
  }

  @Post(':id/images')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Upload des photos d\'un bien' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('images[]', 4))
  uploadImages(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @UploadedFiles() _files: Express.Multer.File[],
  ) {
    // TODO: process images with sharp and upload to storage
    const placeholders = (_files || []).map((f, i) => ({
      url: `https://placeholder/${f.originalname}`,
      thumbUrl: `https://placeholder/thumb-${f.originalname}`,
    }));
    return this.service.addImages(id, user.id, user.role, placeholders);
  }

  @Patch(':id/images/:imageId/cover')
   @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Définir la photo de couverture' })
  setCover(@Param('id') id: string, @Param('imageId') imageId: string, @CurrentUser() user: any) {
    return this.service.setCover(id, imageId, user.id, user.role);
  }

  @Delete(':id/images/:imageId')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Supprimer une image' })
  removeImage(@Param('id') id: string, @Param('imageId') imageId: string, @CurrentUser() user: any) {
    return this.service.removeImage(id, imageId, user.id, user.role);
  }

  @Post(':id/documents')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Upload des documents d\'un bien' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('documents[]', 10))
  uploadDocuments(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @UploadedFiles() _files: Express.Multer.File[],
    @Body() body: { names?: string[] },
  ) {
    const docs = (_files || []).map((f, i) => ({
      name: (body.names && body.names[i]) || f.originalname,
      url: `https://placeholder/${f.originalname}`,
    }));
    return this.service.addDocuments(id, user.id, user.role, docs);
  }

  @Get(':id/applications')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Liste des candidatures reçues' })
  getApplications(@Param('id') id: string) {
    return { data: [], message: 'Voir ApplicationsController' };
  }
}
