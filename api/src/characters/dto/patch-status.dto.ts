import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const CONDITION_SEVERITIES = ['minor', 'major'] as const;

/** A status condition with a server-minted nanoid id (absent `id` = create). */
export class ConditionItemDto {
  @ApiPropertyOptional({ description: 'Omit to create; provide to update' })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiPropertyOptional({ description: 'Required when creating (no id)' })
  @ValidateIf((o: ConditionItemDto) => o.id === undefined || o.id === null)
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({ enum: CONDITION_SEVERITIES })
  @IsOptional()
  @IsIn(CONDITION_SEVERITIES)
  severity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}

export class ConditionCollectionDto {
  @ApiPropertyOptional({ type: [ConditionItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConditionItemDto)
  items?: ConditionItemDto[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  deletedIds?: string[];
}

export class PatchStatusDto {
  @ApiPropertyOptional({ type: ConditionCollectionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ConditionCollectionDto)
  positiveConditions?: ConditionCollectionDto;

  @ApiPropertyOptional({ type: ConditionCollectionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ConditionCollectionDto)
  negativeConditions?: ConditionCollectionDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  criticalState?: boolean;
}
