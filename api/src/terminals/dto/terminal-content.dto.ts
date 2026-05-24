import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
  IsArray,
  IsEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsStateVarMap,
  STATE_VAR_TYPES,
  StateVarType,
} from './is-state-var-map.decorator';

export { STATE_VAR_TYPES };
export type { StateVarType };

export class StateVarDto {
  @IsIn(STATE_VAR_TYPES)
  type: StateVarType;

  @IsOptional()
  default?: unknown;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  values?: string[];
}

export class StateDeclarationDto {
  @IsOptional()
  @IsStateVarMap()
  local?: Record<string, StateVarDto>;

  @IsOptional()
  @IsStateVarMap()
  global?: Record<string, StateVarDto>;
}

export class MetaDto {
  @ApiProperty()
  @IsString()
  title: string;

  @ApiPropertyOptional({
    description: 'Human-authored slug for hidden-terminal lookup',
  })
  @IsOptional()
  @IsString()
  hiddenId?: string;

  @ApiPropertyOptional({
    type: 'string',
    readOnly: true,
    description:
      'Server-injected mirror of the top-level id; must NOT be sent on input.',
  })
  @IsOptional()
  @IsEmpty({ message: 'meta.id is server-owned and not accepted on input' })
  id?: never;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  public?: boolean;
}

export class FictionalUserDto {
  @IsString()
  username: string;

  @IsString()
  password: string;
}

export class LoginBlockDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FictionalUserDto)
  users: FictionalUserDto[];
}

export class TerminalContentDto {
  @ApiProperty()
  @ValidateNested()
  @Type(() => MetaDto)
  meta: MetaDto;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => StateDeclarationDto)
  state?: StateDeclarationDto;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => LoginBlockDto)
  login?: LoginBlockDto;

  @ApiProperty({ description: 'Node map (key → node object)' })
  @IsObject()
  nodes: Record<string, unknown>;
}
