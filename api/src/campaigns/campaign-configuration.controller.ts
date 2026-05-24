import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ConfigurationService } from '../configuration/configuration.service';
import { JwtOptionalGuard } from '../common/guards/jwt-optional.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { CampaignAccessGuard } from '../common/guards/campaign-access.guard';
import { AuthenticatedUser } from '../auth/jwt.strategy';

@ApiTags('campaigns')
@Controller('campaigns')
export class CampaignConfigurationController {
  constructor(private readonly configurationService: ConfigurationService) {}

  @Get(':id/configuration')
  @UseGuards(JwtOptionalGuard, CampaignAccessGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get effective campaign configuration (campaign ⊕ user)',
  })
  getConfiguration(
    @Param('id') id: string,
    @Request() req: { user?: AuthenticatedUser },
  ) {
    return this.configurationService.getCampaignConfiguration(id, req.user);
  }

  @Put(':id/configuration/terminal')
  @UseGuards(JwtOptionalGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Replace campaign terminal configuration domain (admin)',
  })
  setTerminalDomain(@Param('id') id: string, @Body() body: unknown) {
    return this.configurationService.setCampaignDomain(id, 'terminal', body);
  }
}
