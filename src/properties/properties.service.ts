import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Property,
  PropertyDocument,
  PropertyImage,
  PropertyStatus,
  Role,
} from '@prisma/client';
import type { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import type { SearchRequest, SortClause } from '../common/interfaces/search-request.interface';
import { v4 as uuidv4 } from 'uuid';
import { CreatePropertyDto, FilterPropertiesDto, UpdatePropertyDto } from './dto/create-property.dto';
import { PropertyDocumentInput, PropertyImageInput } from './dto/create-property.dto';
import {
  PropertyCreateData,
  PropertyListItem,
  PropertyRepository,
  PropertyWithDetails,
} from './property.repository';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function buildPriceLabel(price: number): string {
  return price.toLocaleString('fr-FR') + ' FCFA/mois';
}

@Injectable()
export class PropertiesService {
  constructor(private readonly repository: PropertyRepository) {}

  listPublic(query: FilterPropertiesDto): Promise<PaginatedResult<PropertyListItem>> {
    return this.repository.findListPaginated(
      this.toSearchRequest(query),
      { isPublished: true },
    );
  }

  listDashboard(
    userId: string,
    role: string,
    query: FilterPropertiesDto,
  ): Promise<PaginatedResult<PropertyListItem>> {
    const extraWhere =
      role === Role.ADMIN ? {} :
      role === Role.MANAGER ? { managerId: userId } :
      { ownerId: userId };

    return this.repository.findListPaginated(this.toSearchRequest(query), extraWhere);
  }

  async getBySlug(slug: string): Promise<PropertyWithDetails> {
    const property = await this.repository.findBySlugPublic(slug);
    if (!property) throw new NotFoundException('Bien introuvable.');
    return property;
  }

  async getById(id: string): Promise<PropertyWithDetails> {
    const property = await this.repository.findByIdWithDetails(id);
    if (!property) throw new NotFoundException('Bien introuvable.');
    return property;
  }

  async create(ownerId: string, dto: CreatePropertyDto): Promise<Property> {
    const slug = `${slugify(dto.title)}-${uuidv4().substring(0, 8)}`;
    return this.repository.create({
      ...dto,
      slug,
      priceLabel: buildPriceLabel(dto.price),
      ownerId,
    });
  }

  async update(
    id: string,
    userId: string,
    role: string,
    dto: UpdatePropertyDto,
  ): Promise<Property> {
    await this.checkOwnership(id, userId, role);
    const data: Partial<PropertyCreateData> = { ...dto };
    if (dto.price !== undefined) data.priceLabel = buildPriceLabel(dto.price);
    return this.repository.update(id, data);
  }

  async setPublished(
    id: string,
    userId: string,
    role: string,
    isPublished: boolean,
  ): Promise<Property> {
    await this.checkOwnership(id, userId, role);

    if (isPublished) {
      const imageCount = await this.repository.countImages(id);
      if (imageCount === 0) {
        throw new ConflictException('Le bien doit avoir au moins 1 image pour être publié.');
      }
    }

    return this.repository.update(id, { isPublished });
  }

  async setStatus(
    id: string,
    userId: string,
    role: string,
    status: PropertyStatus,
  ): Promise<Property> {
    if (status === PropertyStatus.RENTED && role !== Role.ADMIN) {
      throw new ForbiddenException('Le statut Rented est géré automatiquement.');
    }
    await this.checkOwnership(id, userId, role);
    return this.repository.update(id, { status });
  }

  async remove(id: string, userId: string, role: string): Promise<void> {
    await this.checkOwnership(id, userId, role);

    if (await this.repository.hasActiveContract(id)) {
      throw new ConflictException({
        error: 'PROPERTY_HAS_ACTIVE_CONTRACT',
        message: 'Impossible de supprimer un bien avec un contrat actif.',
      });
    }

    await this.repository.softDelete(id);
  }

  async addImages(
    id: string,
    userId: string,
    role: string,
    images: PropertyImageInput[],
  ): Promise<{ images: PropertyImage[] }> {
    await this.checkOwnership(id, userId, role);

    const currentCount = await this.repository.countImages(id);
    if (currentCount + images.length > 4) {
      throw new ConflictException({
        error: 'MAX_IMAGES_REACHED',
        message: 'Maximum 4 images par bien.',
      });
    }

    const hasCover = await this.repository.findFirstCoverImage(id);

    const items = images.map((img, idx) => ({
      propertyId: id,
      url: img.url,
      thumbUrl: img.thumbUrl,
      isCover: !hasCover && idx === 0,
      order: currentCount + idx,
    }));

    const created = await this.repository.createImages(items);
    return { images: created };
  }

  async setCover(
    propertyId: string,
    imageId: string,
    userId: string,
    role: string,
  ): Promise<PropertyImage> {
    await this.checkOwnership(propertyId, userId, role);
    return this.repository.setCoverImage(propertyId, imageId);
  }

  async removeImage(
    propertyId: string,
    imageId: string,
    userId: string,
    role: string,
  ): Promise<void> {
    await this.checkOwnership(propertyId, userId, role);

    const img = await this.repository.findImageById(imageId, propertyId);
    if (!img) throw new NotFoundException('Image introuvable.');

    await this.repository.deleteImageById(imageId);

    if (img.isCover) {
      const next = await this.repository.findFirstImage(propertyId);
      if (next) await this.repository.setImageCover(next.id, true);
    }
  }

  async addDocuments(
    propertyId: string,
    userId: string,
    role: string,
    docs: PropertyDocumentInput[],
  ): Promise<{ documents: PropertyDocument[] }> {
    await this.checkOwnership(propertyId, userId, role);
    const created = await this.repository.createDocuments(
      docs.map((doc) => ({ propertyId, name: doc.name, url: doc.url })),
    );
    return { documents: created };
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Convert FilterPropertiesDto (HTTP query params, 1-based page) into the
   * generic SearchRequest used by the repository layer (0-based pageNumber).
   */
  private toSearchRequest(dto: FilterPropertiesDto): SearchRequest {
    const filters: Record<string, string[]> = {};

    if (dto.city)               filters.city         = [dto.city];
    if (dto.neighborhood)       filters.neighborhood = [dto.neighborhood];
    if (dto.type)               filters.type         = [dto.type];
    if (dto.status)             filters.status       = [dto.status];
    if (dto.bedrooms !== undefined) filters.bedrooms = [String(dto.bedrooms)];
    if (dto.minPrice !== undefined || dto.maxPrice !== undefined) {
      filters.price = [String(dto.minPrice ?? ''), String(dto.maxPrice ?? '')];
    }
    if (dto.minArea !== undefined || dto.maxArea !== undefined) {
      filters.area = [String(dto.minArea ?? ''), String(dto.maxArea ?? '')];
    }

    const sortClauses: SortClause[] = [];
    if (dto.sort === 'price')     sortClauses.push({ fieldName: 'price',     direction: 'ASC' });
    else if (dto.sort === '-price')    sortClauses.push({ fieldName: 'price',     direction: 'DESC' });
    else if (dto.sort === 'createdAt') sortClauses.push({ fieldName: 'createdAt', direction: 'ASC' });
    else                               sortClauses.push({ fieldName: 'createdAt', direction: 'DESC' });

    return {
      searchKey:  dto.search,
      filters,
      pageNumber: (dto.page ?? 1) - 1,   // FilterPropertiesDto is 1-based → 0-based
      pageSize:   dto.limit ?? 20,
      sortClauses,
    };
  }

  private async checkOwnership(id: string, userId: string, role: string): Promise<Property> {
    const property = await this.repository.findByIdActive(id);
    if (!property) throw new NotFoundException('Bien introuvable.');

    if (role === Role.ADMIN) return property;

    if (role === Role.OWNER && property.ownerId !== userId) {
      throw new ForbiddenException({
        error: 'INSUFFICIENT_PERMISSIONS',
        message: 'Droits insuffisants.',
      });
    }
    if (role === Role.MANAGER && property.managerId !== userId) {
      throw new ForbiddenException({
        error: 'INSUFFICIENT_PERMISSIONS',
        message: 'Droits insuffisants.',
      });
    }

    return property;
  }
}
