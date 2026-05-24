import { IsEnum, IsString, Matches, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ example: 'alice' })
  @IsString()
  @Matches(/^[a-zA-Z0-9_.-]{3,32}$/, {
    message: 'username must be 3–32 alphanumeric chars',
  })
  username: string;

  @ApiProperty()
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  password: string;

  @ApiProperty({ enum: ['admin', 'player'] })
  @IsEnum(['admin', 'player'])
  role: 'admin' | 'player';
}
