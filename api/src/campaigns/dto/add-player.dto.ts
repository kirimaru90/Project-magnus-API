import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddPlayerDto {
  @ApiProperty({ description: 'ID of the player user to assign' })
  @IsString()
  playerId: string;
}
