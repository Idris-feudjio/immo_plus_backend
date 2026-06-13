import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { Role } from '@prisma/client';

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\+237[0-9]{8,9}$/, { message: 'Numéro invalide.' })
  phone?: string;
}

export class AdminUpdateUserDto {
  @ApiPropertyOptional({ enum: ['OWNER', 'TENANT', 'MANAGER'], description: 'Le rôle ADMIN ne peut pas être assigné via cette route' })
  @IsOptional()
  @IsEnum(['OWNER', 'TENANT', 'MANAGER'])
  role?: Exclude<Role, Role.ADMIN>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class DelegationDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  managerId!: string;

  @ApiProperty({ type: [String], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  propertyIds!: string[];
}
