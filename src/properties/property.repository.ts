import { Injectable } from '@nestjs/common';
import {
  ContractStatus,
  Prisma,
  Property,
  PropertyDocument,
  PropertyImage,
  PropertyStatus,
  PropertyType,
} from '@prisma/client';
import {
  BaseRepository,
  PrismaModelDelegate,
} from '../common/abstractions/base.repository';
import { buildMeta } from '../common/utils/pagination.util';
import { PrismaService } from '../prisma/prisma.service';
import type { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import type { QueryField, SearchRequest } from '../common/interfaces/search-request.interface';
import { CreatePropertyDto, FilterPropertiesDto } from './dto/create-property.dto';

// ─── Exported types ───────────────────────────────────────────────────────────

export type PropertyWithDetails = Property & {
  images: PropertyImage[];
  documents: PropertyDocument[];
};

export interface PropertyListItem {
  id: string;
  slug: string;
  title: string;
  type: PropertyType;
  city: string;
  neighborhood: string;
  address: string;
  price: number;
  priceLabel: string;
  area: Prisma.Decimal;
  bedrooms: number | null;
  bathrooms: number | null;
  status: PropertyStatus;
  isPublished: boolean;
  createdAt: Date;
  images: { url: string; thumbUrl: string | null }[];
}

/**
 * Data shape passed to repository.create() — the incoming DTO enriched with
 * computed fields (slug, priceLabel) and resolved relations (ownerId).
 */
export type PropertyCreateData = CreatePropertyDto & {
  slug: string;
  priceLabel: string;
  ownerId: string;
  /** Controlled by setPublished() — not sent by clients in the create DTO. */
  isPublished?: boolean;
};

// ─── QueryField declarations ──────────────────────────────────────────────────

const PROPERTY_QUERY_FIELDS: QueryField[] = [
  { filterKey: 'title',        prismaField: 'title',        searchable: true },
  { filterKey: 'description',  prismaField: 'description',  searchable: true },
  { filterKey: 'address',      prismaField: 'address',      searchable: true },
  { filterKey: 'city',         prismaField: 'city',         searchable: true,  filterable: true, sortable: false, filterType: 'contains' },
  { filterKey: 'neighborhood', prismaField: 'neighborhood', searchable: true,  filterable: true, sortable: false, filterType: 'contains' },
  { filterKey: 'type',         prismaField: 'type',         filterable: true,  sortable: false,  filterType: 'in' },
  { filterKey: 'status',       prismaField: 'status',       filterable: true,  sortable: false,  filterType: 'in' },
  { filterKey: 'bedrooms',     prismaField: 'bedrooms',     filterable: true,  sortable: false,  filterType: 'exact' },
  { filterKey: 'price',        prismaField: 'price',        filterable: true,  sortable: true,   filterType: 'range' },
  { filterKey: 'area',         prismaField: 'area',         filterable: true,  sortable: true,   filterType: 'range' },
  { filterKey: 'isPublished',  prismaField: 'isPublished',  filterable: true,  sortable: false,  filterType: 'boolean' },
  { filterKey: 'createdAt',    prismaField: 'createdAt',    sortable: true },
];

// ─── Select projection for list endpoints ─────────────────────────────────────

const LIST_SELECT = {
  id: true,
  slug: true,
  title: true,
  type: true,
  city: true,
  neighborhood: true,
  address: true,
  price: true,
  priceLabel: true,
  area: true,
  bedrooms: true,
  bathrooms: true,
  status: true,
  isPublished: true,
  createdAt: true,
  images: {
    where: { isCover: true },
    take: 1,
    select: { url: true, thumbUrl: true },
  },
} satisfies Prisma.PropertySelect;

// ─── Repository ───────────────────────────────────────────────────────────────

@Injectable()
export class PropertyRepository extends BaseRepository<Property, PropertyCreateData> {
  constructor(private readonly prisma: PrismaService) {
    super(
      prisma.property as unknown as PrismaModelDelegate<Property>,
      PROPERTY_QUERY_FIELDS,
    );
  }

  // ── Property queries ────────────────────────────────────────────────────────

  /** Find a non-deleted property by id. */
  findByIdActive(id: string): Promise<Property | null> {
    return this.prisma.property.findFirst({ where: { id, deletedAt: null } });
  }

  /** Find a non-deleted property with full images + documents. */
  findByIdWithDetails(id: string): Promise<PropertyWithDetails | null> {
    return this.prisma.property.findFirst({
      where: { id, deletedAt: null },
      include: {
        images: { orderBy: { order: 'asc' } },
        documents: true,
      },
    });
  }

  /** Find a published property by slug with full details. */
  findBySlugPublic(slug: string): Promise<PropertyWithDetails | null> {
    return this.prisma.property.findFirst({
      where: { slug, isPublished: true, deletedAt: null },
      include: {
        images: { orderBy: { order: 'asc' } },
        documents: true,
      },
    });
  }

  /**
   * Paginated list with cover image, using SearchRequest for filtering / sorting.
   * @param extraWhere  Server-side conditions merged before search (e.g. { ownerId, deletedAt: null }).
   */
  async findListPaginated(
    request: SearchRequest,
    extraWhere: Record<string, unknown> = {},
  ): Promise<PaginatedResult<PropertyListItem>> {
    const pageNumber = request.pageNumber ?? 0;
    const pageSize = request.pageSize ?? 10;
    const where = this.buildSearchWhere(request, { deletedAt: null, ...extraWhere });
    const rawOrder = this.buildSearchOrderBy(request.sortClauses);
    const orderBy: Prisma.PropertyOrderByWithRelationInput =
      rawOrder.length > 0
        ? (rawOrder[0] as Prisma.PropertyOrderByWithRelationInput)
        : { createdAt: 'desc' };

    const [data, total] = await Promise.all([
      this.prisma.property.findMany({
        where,
        skip: pageNumber * pageSize,
        take: pageSize,
        orderBy,
        select: LIST_SELECT,
      }),
      this.prisma.property.count({ where }),
    ]);

    return { data: data as PropertyListItem[], meta: buildMeta(total, pageNumber, pageSize) };
  }

  /** Soft-delete a property by setting deletedAt. */
  async softDelete(id: string): Promise<void> {
    await this.prisma.property.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /** Returns true when the property has at least one ACTIVE contract. */
  async hasActiveContract(propertyId: string): Promise<boolean> {
    const contract = await this.prisma.contract.findFirst({
      where: { propertyId, status: ContractStatus.ACTIVE },
      select: { id: true },
    });
    return contract !== null;
  }

  // ── Image sub-resource ──────────────────────────────────────────────────────

  countImages(propertyId: string): Promise<number> {
    return this.prisma.propertyImage.count({ where: { propertyId } });
  }

  findImageById(imageId: string, propertyId: string): Promise<PropertyImage | null> {
    return this.prisma.propertyImage.findFirst({ where: { id: imageId, propertyId } });
  }

  async createImages(
    items: { propertyId: string; url: string; thumbUrl: string; isCover: boolean; order: number }[],
  ): Promise<PropertyImage[]> {
    return Promise.all(items.map((data) => this.prisma.propertyImage.create({ data })));
  }

  async setCoverImage(propertyId: string, imageId: string): Promise<PropertyImage> {
    await this.prisma.propertyImage.updateMany({
      where: { propertyId },
      data: { isCover: false },
    });
    return this.prisma.propertyImage.update({
      where: { id: imageId },
      data: { isCover: true },
    });
  }

  async deleteImageById(imageId: string): Promise<void> {
    await this.prisma.propertyImage.delete({ where: { id: imageId } });
  }

  findFirstImage(propertyId: string): Promise<PropertyImage | null> {
    return this.prisma.propertyImage.findFirst({
      where: { propertyId },
      orderBy: { order: 'asc' },
    });
  }

  async setImageCover(imageId: string, isCover: boolean): Promise<void> {
    await this.prisma.propertyImage.update({
      where: { id: imageId },
      data: { isCover },
    });
  }

  findFirstCoverImage(propertyId: string): Promise<PropertyImage | null> {
    return this.prisma.propertyImage.findFirst({ where: { propertyId, isCover: true } });
  }

  // ── Document sub-resource ───────────────────────────────────────────────────

  async createDocuments(
    items: { propertyId: string; name: string; url: string }[],
  ): Promise<PropertyDocument[]> {
    return Promise.all(items.map((data) => this.prisma.propertyDocument.create({ data })));
  }
}

// Re-export FilterPropertiesDto so service can import from a single place
export { FilterPropertiesDto };
