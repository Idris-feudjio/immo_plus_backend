import { CommissionType, type MandateStatus } from '@prisma/client';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateMandateDto {
  @IsString()
  @IsNotEmpty()
  propertyId!: string;

  @IsEmail()
  managerEmail!: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsEnum(CommissionType)
  commissionType?: CommissionType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  commissionValue?: number;

  @IsOptional()
  @IsString()
  description?: string;
}

export class TerminateMandateDto {
  reason?: string;
}

export class ListMandatesDto {
  status?: MandateStatus;
  propertyId?: string;
  agencyId?: string;
  page?: number;
  limit?: number;
}
