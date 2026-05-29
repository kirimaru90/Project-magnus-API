import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** A perk with a server-minted nanoid id (absent `id` = create). */
export class PerkItemDto {
  @ApiPropertyOptional({ description: 'Omit to create; provide to update' })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiPropertyOptional({ description: 'Required when creating (no id)' })
  @ValidateIf((o: PerkItemDto) => o.id === undefined || o.id === null)
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  icon?: string;
}

export class PatchPerksDto {
  @ApiPropertyOptional({ type: [PerkItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PerkItemDto)
  items?: PerkItemDto[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  deletedIds?: string[];
}
