import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PropertyStatus, PropertyType } from '@prisma/client';
import { Exclude, Expose, Type } from 'class-transformer';

@Exclude()
export class PropertyImageResponseDto {
  @Expose() @ApiProperty() id: string;
  @Expose() @ApiProperty() url: string;
  @Expose() @ApiPropertyOptional() thumbUrl: string | null;
  @Expose() @ApiProperty() isCover: boolean;
  @Expose() @ApiProperty() order: number;
}

@Exclude()
export class PropertyDocumentResponseDto {
  @Expose() @ApiProperty() id: string;
  @Expose() @ApiProperty() name: string;
  @Expose() @ApiProperty() url: string;
  @Expose() @ApiPropertyOptional() documentType: string | null;
  @Expose() @ApiProperty() createdAt: Date;
}

@Exclude()
export class ResponsePropertyDto {
  @Expose() @ApiProperty() id: string;
  @Expose() @ApiProperty() slug: string;
  @Expose() @ApiProperty() title: string;
  @Expose() @ApiProperty({ enum: PropertyType }) type: PropertyType;
  @Expose() @ApiProperty() city: string;
  @Expose() @ApiProperty() neighborhood: string;
  @Expose() @ApiProperty() address: string;
  @Expose() @ApiPropertyOptional() latitude: number | null;
  @Expose() @ApiPropertyOptional() longitude: number | null;
  @Expose() @ApiProperty() price: number;
  @Expose() @ApiProperty() priceLabel: string;
  @Expose() @ApiProperty() area: number;
  @Expose() @ApiPropertyOptional() bedrooms: number | null;
  @Expose() @ApiPropertyOptional() bathrooms: number | null;
  @Expose() @ApiPropertyOptional() floor: number | null;
  @Expose() @ApiPropertyOptional() description: string | null;
  @Expose() @ApiProperty({ enum: PropertyStatus }) status: PropertyStatus;
  @Expose() @ApiProperty() isPublished: boolean;
  @Expose() @ApiProperty() createdAt: Date;
  @Expose() @ApiProperty() updatedAt: Date;

  @Expose()
  @Type(() => PropertyImageResponseDto)
  @ApiPropertyOptional({ type: () => PropertyImageResponseDto, isArray: true })
  images?: PropertyImageResponseDto[];

  @Expose()
  @Type(() => PropertyDocumentResponseDto)
  @ApiPropertyOptional({ type: () => PropertyDocumentResponseDto, isArray: true })
  documents?: PropertyDocumentResponseDto[];

  // ownerId, managerId, deletedAt — excluded by @Exclude() on the class
}
