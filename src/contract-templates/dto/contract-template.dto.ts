import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ContractSection } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateContractTemplateDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ enum: ContractSection, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(ContractSection, { each: true })
  lockedSections?: ContractSection[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(2000, { each: true })
  clauses?: string[];
}

export class UpdateContractTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ enum: ContractSection, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(ContractSection, { each: true })
  lockedSections?: ContractSection[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(2000, { each: true })
  clauses?: string[];
}
