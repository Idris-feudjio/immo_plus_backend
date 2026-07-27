import { ApiProperty } from '@nestjs/swagger';
import { Gender } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class SubmitApplicationDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName: string;

  @ApiProperty({ enum: Gender })
  @IsEnum(Gender)
  gender: Gender;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  nationalIdNumber: string;

  @ApiProperty()
  @IsString()
  @Matches(/^\+237[0-9]{8,9}$/, {
    message: 'Le téléphone doit commencer par +237 et être valide.',
  })
  phone: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  income: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  propertyId: string;
}
