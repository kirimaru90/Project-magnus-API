import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { StateService } from '../state/state.service';
import { MutateStateDto } from '../state/dto/mutation.dto';
import { StateSchemaPatchDto } from '../state/dto/schema-patch.dto';
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

  @Patch(':id/state/schema')
  @HttpCode(200)
  @UseGuards(JwtOptionalGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Add/update/delete campaign state schema variables (admin)',
  })
  @ApiResponse({
    status: 200,
    description: 'Schema patched; returns flat state snapshot',
  })
  @ApiResponse({ status: 400, description: 'Validation error or empty ops' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Forbidden — admin required' })
  @ApiResponse({ status: 404, description: 'Campaign or variable not found' })
  @ApiResponse({
    status: 409,
    description: 'Delete references a terminal, or rename target collision',
  })
  patchSchema(@Param('id') id: string, @Body() dto: StateSchemaPatchDto) {
    return this.stateService.patchCampaignSchema(id, dto.ops);
  }
}
