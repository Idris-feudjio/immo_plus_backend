import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { AgencyMemberRole } from '@prisma/client';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export interface PublicAgencyProfile {
  id: string;
  name: string;
  address: string | null;
  phone: string;
  email: string;
  managedPropertiesCount: number;
}

export class CreateAgencyDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @Matches(/^\+237[0-9]{8,9}$/, {
    message: 'Le téléphone doit commencer par +237 et être valide.',
  })
  phone!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  rccm?: string;
}

export class ListAgenciesDto {
  page?: number;
  limit?: number;
}

export class AddAgencyMemberDto {
  userId!: string;
  role?: AgencyMemberRole;
}
