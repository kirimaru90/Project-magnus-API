import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { StateService } from '../state/state.service';
import { MutateStateDto } from '../state/dto/mutation.dto';
import { JwtOptionalGuard } from '../common/guards/jwt-optional.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { CampaignAccessGuard } from '../common/guards/campaign-access.guard';

@ApiTags('campaigns')
@Controller('campaigns')
export class CampaignStateController {
  constructor(private readonly stateService: StateService) {}

  @Get(':id/state')
  @UseGuards(JwtOptionalGuard, CampaignAccessGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get campaign global state' })
  getState(@Param('id') id: string) {
    return this.stateService.getCampaignState(id);
  }

  @Post(':id/state/mutate')
  @HttpCode(200)
  @UseGuards(JwtOptionalGuard, CampaignAccessGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mutate campaign global state' })
  mutateState(@Param('id') id: string, @Body() dto: MutateStateDto) {
    return this.stateService.mutateCampaignState(id, dto.mutations);
  }

  @Post(':id/state/reset')
  @HttpCode(200)
  @UseGuards(JwtOptionalGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Reset all campaign global state + all terminals (admin)',
  })
  resetState(@Param('id') id: string) {
    return this.stateService.resetCampaignState(id);
  }

  @Post(':id/state/:key/reset')
  @HttpCode(200)
  @UseGuards(JwtOptionalGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reset single campaign state variable (admin)' })
  resetStateKey(@Param('id') id: string, @Param('key') key: string) {
    return this.stateService.resetCampaignStateKey(id, key);
  }
}
