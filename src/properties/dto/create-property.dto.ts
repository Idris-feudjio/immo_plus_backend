import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PropertyType, PropertyStatus } from '@prisma/client';

export interface PropertyImageInput {
  id: string;
  url: string;
  thumbUrl: string;
}

export interface PropertyDocumentInput {
  name: string;
  url: string;
}
import {
  IsDecimal,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Type } from 'class-transformer';

const GPS_MESSAGE = 'Coordonnées GPS invalides';

interface CoordinateHolder {
  latitude?: number | null;
  longitude?: number | null;
}

/** `undefined` = field omitted (untouched on update), `null` = explicitly cleared, else a value to range-check. */
type CoordinateState = 'unset' | 'cleared' | 'value';

function coordinateState(value: number | null | undefined): CoordinateState {
  if (value === undefined) return 'unset';
  if (value === null) return 'cleared';
  return 'value';
}

/**
 * Validates one coordinate (latitude or longitude) together with its pair:
 * - both omitted, or both explicitly `null` (clearing a previously-set location) → valid.
 * - both present as numbers within their WGS84 range → valid.
 * - anything else (one set without the other, out-of-range, wrong type) → invalid.
 * Deliberately NOT built on `@ValidateIf` — that gates every decorator on a property,
 * which would also skip this pairing check whenever the field itself is unset/null.
 */
abstract class CoordinateConstraint implements ValidatorConstraintInterface {
  protected abstract readonly min: number;
  protected abstract readonly max: number;

  validate(value: unknown, args: ValidationArguments): boolean {
    const o = args.object as CoordinateHolder;
    if (coordinateState(o.latitude) !== coordinateState(o.longitude)) return false;
    if (value === undefined || value === null) return true;
    return typeof value === 'number' && !Number.isNaN(value) && value >= this.min && value <= this.max;
  }

  defaultMessage(): string {
    return GPS_MESSAGE;
  }
}

@ValidatorConstraint({ name: 'latitudeValid', async: false })
class LatitudeConstraint extends CoordinateConstraint {
  protected readonly min = -90;
  protected readonly max = 90;
}

@ValidatorConstraint({ name: 'longitudeValid', async: false })
class LongitudeConstraint extends CoordinateConstraint {
  protected readonly min = -180;
  protected readonly max = 180;
}

export class CreatePropertyDto {
  @ApiProperty()
  @IsString()
  title: string;

  @ApiProperty({ enum: PropertyType })
  @IsEnum(PropertyType)
  type: PropertyType;

  @ApiProperty()
  @IsString()
  city: string;

  @ApiProperty()
  @IsString()
  neighborhood: string;

  @ApiProperty()
  @IsString()
  address: string;

  @ApiPropertyOptional({ nullable: true, description: 'null clears a previously-set location; must be provided together with longitude' })
  @Type(() => Number)
  @Validate(LatitudeConstraint)
  latitude?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'null clears a previously-set location; must be provided together with latitude' })
  @Type(() => Number)
  @Validate(LongitudeConstraint)
  longitude?: number | null;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  price: number;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  area: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  bedrooms?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  bathrooms?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  floor?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: PropertyStatus })
  @IsOptional()
  @IsEnum(PropertyStatus)
  status?: PropertyStatus;
}

export class UpdatePropertyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ enum: PropertyType })
  @IsOptional()
  @IsEnum(PropertyType)
  type?: PropertyType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  neighborhood?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ nullable: true, description: 'null clears a previously-set location; must be provided together with longitude' })
  @Type(() => Number)
  @Validate(LatitudeConstraint)
  latitude?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'null clears a previously-set location; must be provided together with latitude' })
  @Type(() => Number)
  @Validate(LongitudeConstraint)
  longitude?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  price?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  area?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  bedrooms?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  bathrooms?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  floor?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}

export class FilterPropertiesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  neighborhood?: string;

  @ApiPropertyOptional({ enum: PropertyType })
  @IsOptional()
  @IsEnum(PropertyType)
  type?: PropertyType;

  @ApiPropertyOptional({ enum: PropertyStatus })
  @IsOptional()
  @IsEnum(PropertyStatus)
  status?: PropertyStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  minPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  maxPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minArea?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxArea?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  bedrooms?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sort?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  page?: number = 1;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number = 20;

  @ApiPropertyOptional()
  @IsOptional()
  isPublished?: boolean;
}
