import { Body, Controller, Get, Put, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ConfigurationService } from '../configuration/configuration.service';
import { JwtRequiredGuard } from '../common/guards/jwt-required.guard';
import { AuthenticatedUser } from '../auth/jwt.strategy';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtRequiredGuard)
@Controller('users/me/configuration')
export class UserConfigurationController {
  constructor(private readonly configurationService: ConfigurationService) {}

  @Get()
  @ApiOperation({ summary: 'Get own configuration (authenticated)' })
  getConfiguration(@Request() req: { user: AuthenticatedUser }) {
    return this.configurationService.getUserConfiguration(req.user.id);
  }

  @Put('terminal')
  @ApiOperation({
    summary: 'Replace own terminal configuration domain (authenticated)',
  })
  setTerminalDomain(
    @Request() req: { user: AuthenticatedUser },
    @Body() body: unknown,
  ) {
    return this.configurationService.setUserDomain(
      req.user.id,
      'terminal',
      body,
    );
  }
}
