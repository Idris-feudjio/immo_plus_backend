import { Property, PropertyImage, PropertyDocument, PropertyStatus } from '@prisma/client';
import { PaginatedResult } from '../../common/interfaces/paginated-result.interface';
import { CreatePropertyDto, FilterPropertiesDto, UpdatePropertyDto } from '../dto/create-property.dto';
import { PropertyListItem, PropertyWithDetails } from '../property.repository';

export const PROPERTY_SERVICE = 'IPropertyService';

export interface PropertyImageInput {
  url: string;
  thumbUrl: string;
}

export interface PropertyDocumentInput {
  name: string;
  url: string;
}

export interface IPropertyService {
  listPublic(query: FilterPropertiesDto): Promise<PaginatedResult<PropertyListItem>>;
  listDashboard(
    userId: string,
    role: string,
    query: FilterPropertiesDto,
  ): Promise<PaginatedResult<PropertyListItem>>;
  getBySlug(slug: string): Promise<PropertyWithDetails>;
  getById(id: string): Promise<PropertyWithDetails>;
  create(ownerId: string, dto: CreatePropertyDto): Promise<Property>;
  update(id: string, userId: string, role: string, dto: UpdatePropertyDto): Promise<Property>;
  setPublished(id: string, userId: string, role: string, isPublished: boolean): Promise<Property>;
  setStatus(
    id: string,
    userId: string,
    role: string,
    status: PropertyStatus,
  ): Promise<Property>;
  remove(id: string, userId: string, role: string): Promise<void>;
  addImages(
    id: string,
    userId: string,
    role: string,
    images: PropertyImageInput[],
  ): Promise<{ images: PropertyImage[] }>;
  setCover(
    propertyId: string,
    imageId: string,
    userId: string,
    role: string,
  ): Promise<PropertyImage>;
  removeImage(
    propertyId: string,
    imageId: string,
    userId: string,
    role: string,
  ): Promise<void>;
  addDocuments(
    propertyId: string,
    userId: string,
    role: string,
    docs: PropertyDocumentInput[],
  ): Promise<{ documents: PropertyDocument[] }>;
}
