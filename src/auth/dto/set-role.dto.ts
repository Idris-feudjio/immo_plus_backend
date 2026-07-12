import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetRoleDto {
  @ApiProperty({ enum: ['OWNER', 'TENANT'] })
  @IsIn(['OWNER', 'TENANT'])
  role: string;
}
