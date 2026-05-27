import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import { Role } from '@prisma/client';

export class RegisterDto {
  @ApiProperty()
  @IsString()
  firstName: string;

  @ApiProperty()
  @IsString()
  lastName: string;

  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\+237[0-9]{8,9}$/, { message: 'Le téléphone doit commencer par +237 et être valide.' })
  phone?: string;

  @ApiProperty({ enum: ['OWNER', 'MANAGER', 'TENANT'] })
  @IsEnum(['OWNER', 'MANAGER', 'TENANT'])
  role: 'OWNER' | 'MANAGER' | 'TENANT';

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'Le mot de passe doit contenir au moins 1 majuscule et 1 chiffre.',
  })
  password: string;

  @ApiProperty()
  @IsString()
  passwordConfirm: string;
}
