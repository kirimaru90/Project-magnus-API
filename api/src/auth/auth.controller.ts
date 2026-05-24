import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtRequiredGuard } from '../common/guards/jwt-required.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Real-user login — returns a 24h JWT' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.username, dto.password);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Client-side logout (stateless, always 204)' })
  logout() {
    return;
  }

  @Get('me')
  @UseGuards(JwtRequiredGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current session info' })
  me(@Request() req: { user: { id: string } }) {
    return this.authService.me(req.user.id);
  }
}
