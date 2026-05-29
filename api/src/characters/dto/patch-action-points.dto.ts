import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const PA_TRACKED_BY = ['agility', 'endurance'] as const;

/** Partial-merge of the action-point fields (only present fields change). */
export class PatchActionPointsDto {
  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  paMax?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  paCurrent?: number;

  @ApiPropertyOptional({ enum: PA_TRACKED_BY })
  @IsOptional()
  @IsIn(PA_TRACKED_BY)
  paTrackedBy?: string;
}
