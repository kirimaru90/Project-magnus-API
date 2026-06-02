import {
  Allow,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
  ValidateIf,
  ArrayNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const VALID_TYPES = ['boolean', 'number', 'enum', 'string'] as const;
type EntryType = (typeof VALID_TYPES)[number];

export class EntryShapeDto {
  @ApiProperty({ enum: VALID_TYPES })
  @IsIn(VALID_TYPES)
  type: EntryType;

  @ApiProperty({ description: 'Default value; must match type' })
  @Allow()
  default: unknown;

  @ApiPropertyOptional({
    type: [String],
    description: 'Required and non-empty when type is "enum"',
  })
  @ValidateIf((o: EntryShapeDto) => o.type === 'enum')
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsOptional()
  values?: string[];
}

export class AddOpDto {
  @ApiProperty({ enum: ['add'] })
  @IsIn(['add'])
  action: 'add';

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ type: EntryShapeDto })
  @ValidateNested()
  @Type(() => EntryShapeDto)
  entry: EntryShapeDto;

  @ApiPropertyOptional({
    description: 'Initial value; defaults to entry.default when omitted',
  })
  @IsOptional()
  value?: unknown;
}

export class UpdateOpDto {
  @ApiProperty({ enum: ['update'] })
  @IsIn(['update'])
  action: 'update';

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'New name for the variable (rename)' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  rename?: string;

  @ApiProperty({ type: EntryShapeDto })
  @ValidateNested()
  @Type(() => EntryShapeDto)
  entry: EntryShapeDto;

  @ApiPropertyOptional({
    description: 'New value; defaults to entry.default when omitted',
  })
  @IsOptional()
  value?: unknown;
}

export class DeleteOpDto {
  @ApiProperty({ enum: ['delete'] })
  @IsIn(['delete'])
  action: 'delete';

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;
}

export class StateSchemaOpDto {
  @ApiProperty({ enum: ['add', 'update', 'delete'] })
  @IsIn(['add', 'update', 'delete'])
  action: 'add' | 'update' | 'delete';

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'New name for rename (update only)' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  rename?: string;

  @ApiPropertyOptional({
    type: EntryShapeDto,
    description: 'Required for add/update',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => EntryShapeDto)
  entry?: EntryShapeDto;

  @ApiPropertyOptional()
  @IsOptional()
  value?: unknown;
}

export class StateSchemaPatchDto {
  @ApiProperty({ type: [StateSchemaOpDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => StateSchemaOpDto)
  ops: StateSchemaOpDto[];
}
