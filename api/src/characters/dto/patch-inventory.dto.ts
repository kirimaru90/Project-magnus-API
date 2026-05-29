import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const TAG_TYPES = ['core', 'extra'] as const;

export class TagDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ enum: TAG_TYPES })
  @IsIn(TAG_TYPES)
  type: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  damaged?: boolean;
}

/** weapons / equip item — server-minted nanoid id (absent `id` = create). */
export class WeaponEquipItemDto {
  @ApiPropertyOptional({ description: 'Omit to create; provide to update' })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiPropertyOptional({ description: 'Required when creating (no id)' })
  @ValidateIf((o: WeaponEquipItemDto) => o.id === undefined || o.id === null)
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({ type: [TagDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TagDto)
  tags?: TagDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  broken?: boolean;
}

/** consumables / other item — server-minted nanoid id (absent `id` = create). */
export class ConsumableGenericItemDto {
  @ApiPropertyOptional({ description: 'Omit to create; provide to update' })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiPropertyOptional({ description: 'Required when creating (no id)' })
  @ValidateIf(
    (o: ConsumableGenericItemDto) => o.id === undefined || o.id === null,
  )
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  quantity?: number;
}

export class WeaponEquipCollectionDto {
  @ApiPropertyOptional({ type: [WeaponEquipItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WeaponEquipItemDto)
  items?: WeaponEquipItemDto[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  deletedIds?: string[];
}

export class ConsumableGenericCollectionDto {
  @ApiPropertyOptional({ type: [ConsumableGenericItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConsumableGenericItemDto)
  items?: ConsumableGenericItemDto[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  deletedIds?: string[];
}

export class PatchInventoryDto {
  @ApiPropertyOptional({ type: WeaponEquipCollectionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WeaponEquipCollectionDto)
  weapons?: WeaponEquipCollectionDto;

  @ApiPropertyOptional({ type: WeaponEquipCollectionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WeaponEquipCollectionDto)
  equip?: WeaponEquipCollectionDto;

  @ApiPropertyOptional({ type: ConsumableGenericCollectionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ConsumableGenericCollectionDto)
  consumables?: ConsumableGenericCollectionDto;

  @ApiPropertyOptional({ type: ConsumableGenericCollectionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ConsumableGenericCollectionDto)
  other?: ConsumableGenericCollectionDto;
}
