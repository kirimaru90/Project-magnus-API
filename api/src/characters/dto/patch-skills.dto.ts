import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const SKILL_LEVELS = ['competent', 'expert', 'master'] as const;

/** A skill keyed by a caller-supplied catalog slug (never server-minted). */
export class SkillItemDto {
  @ApiProperty({ description: 'Catalog slug (e.g. "lockpick")' })
  @IsString()
  id: string;

  @ApiProperty({ enum: SKILL_LEVELS })
  @IsIn(SKILL_LEVELS)
  level: string;
}

export class PatchSkillsDto {
  @ApiPropertyOptional({ type: [SkillItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SkillItemDto)
  items?: SkillItemDto[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Catalog slugs to detach',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  deletedIds?: string[];
}
