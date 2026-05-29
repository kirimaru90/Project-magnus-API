import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const SPECIES = ['human', 'ghoul', 'super_mutant', 'robot'] as const;

export class CreateCharacterDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  name: string;

  @ApiPropertyOptional({ enum: SPECIES })
  @IsOptional()
  @IsIn(SPECIES)
  species?: string;

  @ApiPropertyOptional({
    description: 'Owner user id — required for admins, ignored for players',
  })
  @IsOptional()
  @IsString()
  userId?: string;
}
