import {
  BadRequestException,
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
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PropertyStatus, Role } from '@prisma/client';
import sharp from 'sharp';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Cacheable } from '../common/decorators/cacheable.decorator';
import { CacheEvict } from '../common/decorators/cache-evict.decorator';
import { CheckPlanLimit } from '../common/decorators/check-plan-limit.decorator';
import { CacheInterceptor } from '../common/interceptors/cache.interceptor';
import { MandateGuard } from '../common/guards/mandate.guard';
import { FileValidationPipe } from '../common/pipes/file-validation.pipe';
import { StorageService } from '../storage/storage.service';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import {
  CreatePropertyDto,
  FilterPropertiesDto,
  UpdatePropertyDto,
} from './dto/create-property.dto';
import { PropertiesService } from './properties.service';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const IMAGE_EXT_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const ALLOWED_DOCUMENT_TYPES = ['application/pdf'];
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024;

@ApiTags('Properties')
@Controller('properties')
@UseInterceptors(CacheInterceptor)
export class PropertiesController {
  constructor(
    private readonly service: PropertiesService,
    private readonly storage: StorageService,
  ) {}

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
  listDashboard(
    @CurrentUser() user: AuthUser,
    @Query() query: FilterPropertiesDto,
  ) {
    return this.service.listDashboard(user.id, user.role, query);
  }

  // NOTE: intentionally NOT `@Get(':propertyId')` at the controller root — that would
  // collide with the public `@Get(':slug')` route above (NestJS can't disambiguate two
  // plain path params at the same depth). Follows the `dashboard/list` prefix instead.
  @Get('dashboard/:propertyId')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @UseGuards(MandateGuard)
  @ApiOperation({ summary: "Détail complet d'un bien pour édition (privé)" })
  getForEdit(
    @Param('propertyId') propertyId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.getByIdForOwner(propertyId, user.id, user.role);
  }

  @Post()
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @CheckPlanLimit('properties')
  @CacheEvict({ key: 'properties' })
  @ApiOperation({ summary: 'Créer un bien' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePropertyDto) {
    return this.service.createProperty(user.id, dto);
  }

  @Patch(':propertyId')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @UseGuards(MandateGuard)
  @CacheEvict({ key: 'properties' })
  @ApiOperation({ summary: 'Modifier un bien' })
  update(
    @Param('propertyId') propertyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdatePropertyDto,
  ) {
    return this.service.updateProperty(propertyId, user.id, user.role, dto);
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

  @Patch(':propertyId/status')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @UseGuards(MandateGuard)
  @CacheEvict({ key: 'properties' })
  @ApiOperation({ summary: "Changer le statut d'un bien" })
  setStatus(
    @Param('propertyId') propertyId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { status: PropertyStatus },
  ) {
    return this.service.setStatus(propertyId, user.id, user.role, body.status);
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
  @UseInterceptors(
    FilesInterceptor('images[]', 20, { limits: { fileSize: MAX_IMAGE_SIZE } }),
  )
  async uploadImages(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @UploadedFiles(new FileValidationPipe(ALLOWED_IMAGE_TYPES, MAX_IMAGE_SIZE))
    files: Express.Multer.File[],
  ) {
    // Ownership + quota must be verified BEFORE any R2 write — otherwise an unauthorized
    // or over-quota request still pays for real uploads that get thrown away.
    await this.service.assertCanAddImages(
      id,
      user.id,
      user.role,
      (files ?? []).length,
    );

    const settled = await Promise.allSettled(
      (files ?? []).map(async (file) => {
        const imageId = this.storage.generateId();
        const ext = IMAGE_EXT_MAP[file.mimetype];
        const key = this.storage.generateKey(
          'properties',
          id,
          'images',
          `${imageId}.${ext}`,
        );
        const thumbKey = this.storage.generateKey(
          'properties',
          id,
          'images',
          `${imageId}-thumb.${ext}`,
        );

        let thumbBuffer: Buffer;
        try {
          thumbBuffer = await sharp(file.buffer)
            .resize(300, 300, { fit: 'cover' })
            .toBuffer();
        } catch {
          // mimetype header lied, or the bytes are corrupted — a decode failure is a
          // client error, not a 500.
          throw new BadRequestException('INVALID_FILE_TYPE');
        }

        const [url, thumbUrl] = await Promise.all([
          this.storage.uploadBuffer(key, file.buffer, file.mimetype),
          this.storage.uploadBuffer(thumbKey, thumbBuffer, file.mimetype),
        ]);
        return { id: imageId, url, thumbUrl, key, thumbKey };
      }),
    );

    const rejected = settled.find(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    if (rejected) {
      // Clean up any siblings that finished uploading before this one failed —
      // otherwise they're orphaned in R2 with no DB row ever created for them.
      const fulfilled = settled.filter(
        (
          r,
        ): r is PromiseFulfilledResult<{
          id: string;
          url: string;
          thumbUrl: string;
          key: string;
          thumbKey: string;
        }> => r.status === 'fulfilled',
      );
      await Promise.all(
        fulfilled.flatMap((r) => [
          this.storage.delete(r.value.key),
          this.storage.delete(r.value.thumbKey),
        ]),
      );
      throw rejected.reason instanceof BadRequestException
        ? rejected.reason
        : new BadRequestException('UPLOAD_FAILED');
    }

    const uploaded = (
      settled as PromiseFulfilledResult<{
        id: string;
        url: string;
        thumbUrl: string;
        key: string;
        thumbKey: string;
      }>[]
    ).map((r) => ({
      id: r.value.id,
      url: r.value.url,
      thumbUrl: r.value.thumbUrl,
    }));

    return this.service.addImages(id, user.id, user.role, uploaded);
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
  @UseInterceptors(
    FilesInterceptor('documents[]', 10, {
      limits: { fileSize: MAX_DOCUMENT_SIZE },
    }),
  )
  async uploadDocuments(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @UploadedFiles(
      new FileValidationPipe(ALLOWED_DOCUMENT_TYPES, MAX_DOCUMENT_SIZE),
    )
    files: Express.Multer.File[],
    @Body() body: { names?: string[] },
  ) {
    const docs = await Promise.all(
      (files ?? []).map(async (f, i) => {
        const documentId = this.storage.generateId();
        const key = this.storage.generateKey(
          'properties',
          id,
          'documents',
          `${documentId}.pdf`,
        );
        const url = await this.storage.uploadBuffer(key, f.buffer, f.mimetype);
        return {
          name: (body.names && body.names[i]) || f.originalname,
          url,
        };
      }),
    );
    return this.service.addDocuments(id, user.id, user.role, docs);
  }

  @Get(':id/applications')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Liste des candidatures reçues' })
  getApplications(@Param('id') _id: string) {
    return { data: [], message: 'Voir ApplicationsController' };
  }
}
