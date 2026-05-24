import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MutationItemDto {
  @ApiProperty({ example: 'local.access_count' })
  @IsString()
  @IsNotEmpty()
  key: string;

  @ApiProperty({ enum: ['set', 'increment', 'toggle'] })
  @IsIn(['set', 'increment', 'toggle'])
  op: 'set' | 'increment' | 'toggle';

  @ApiPropertyOptional({ description: 'Value for set operation' })
  @IsOptional()
  value?: unknown;

  @ApiPropertyOptional({
    description: 'Increment amount for increment operation',
  })
  @IsOptional()
  @IsNumber()
  by?: number;
}

export class MutateStateDto {
  @ApiProperty({ type: [MutationItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MutationItemDto)
  mutations: MutationItemDto[];
}
