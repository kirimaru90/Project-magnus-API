import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { TerminalsService } from './terminals.service';
import { StateService } from '../state/state.service';
import { TerminalContentDto } from './dto/terminal-content.dto';
import { FictionalLoginDto } from './dto/fictional-login.dto';
import { MutateStateDto } from '../state/dto/mutation.dto';
import { JwtOptionalGuard } from '../common/guards/jwt-optional.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { CampaignAccessGuard } from '../common/guards/campaign-access.guard';
import { TerminalAccessGuard } from '../common/guards/terminal-access.guard';
import { AuthenticatedUser } from '../auth/jwt.strategy';

@ApiTags('terminals')
@Controller()
export class TerminalsController {
  constructor(
    private readonly terminalsService: TerminalsService,
    private readonly stateService: StateService,
  ) {}

  // --- Campaign-scoped terminal routes ---

  @Get('campaigns/:id/terminals')
  @UseGuards(JwtOptionalGuard, CampaignAccessGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List terminals in campaign' })
  listByCampaign(
    @Param('id') id: string,
    @Request() req: { user?: AuthenticatedUser },
  ) {
    return this.terminalsService.listByCampaign(id, req.user);
  }

  @Post('campaigns/:id/terminals')
  @UseGuards(JwtOptionalGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create terminal in campaign (admin)' })
  create(@Param('id') campaignId: string, @Body() dto: TerminalContentDto) {
    return this.terminalsService.create(campaignId, dto);
  }

  @Post('campaigns/:id/terminals/import')
  @UseGuards(JwtOptionalGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Import terminal from JSON (admin)' })
  import(@Param('id') campaignId: string, @Body() dto: TerminalContentDto) {
    return this.terminalsService.create(campaignId, dto);
  }

  @Get('campaigns/:id/terminals/by-hidden-id/:hiddenId')
  @UseGuards(JwtOptionalGuard, CampaignAccessGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Load hidden terminal by hiddenId slug' })
  loadByHiddenId(
    @Param('id') id: string,
    @Param('hiddenId') hiddenId: string,
    @Request() req: { user?: AuthenticatedUser },
  ) {
    return this.terminalsService.loadByHiddenId(id, hiddenId, req.user);
  }

  // --- Terminal-scoped routes ---

  @Get('terminals/:id')
  @UseGuards(JwtOptionalGuard, TerminalAccessGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Terminal detail (fictional users visible to admin only)',
  })
  detail(
    @Param('id') id: string,
    @Request() req: { user?: AuthenticatedUser },
  ) {
    return this.terminalsService.detail(id, req.user);
  }

  @Put('terminals/:id')
  @UseGuards(JwtOptionalGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update terminal (admin)' })
  update(@Param('id') id: string, @Body() dto: TerminalContentDto) {
    return this.terminalsService.update(id, dto);
  }

  @Delete('terminals/:id')
  @HttpCode(204)
  @UseGuards(JwtOptionalGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete terminal (admin)' })
  delete(@Param('id') id: string) {
    return this.terminalsService.delete(id);
  }

  @Post('terminals/:id/export')
  @UseGuards(JwtOptionalGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Export terminal as full JSON (admin)' })
  export(@Param('id') id: string) {
    return this.terminalsService.export(id);
  }

  @Get('terminals/:id/load')
  @UseGuards(JwtOptionalGuard, TerminalAccessGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Load terminal for playback (content + state)' })
  load(@Param('id') id: string, @Request() req: { user?: AuthenticatedUser }) {
    return this.terminalsService.load(id, req.user);
  }

  @Post('terminals/:id/fictional-login')
  @HttpCode(200)
  @UseGuards(JwtOptionalGuard, TerminalAccessGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Validate fictional user credentials' })
  fictionalLogin(@Param('id') id: string, @Body() dto: FictionalLoginDto) {
    return this.terminalsService.fictionalLogin(id, dto.username, dto.password);
  }

  // --- Terminal state routes ---

  @Get('terminals/:id/state')
  @UseGuards(JwtOptionalGuard, TerminalAccessGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get terminal local state' })
  getState(@Param('id') id: string) {
    return this.stateService.getTerminalState(id);
  }

  @Post('terminals/:id/state/mutate')
  @HttpCode(200)
  @UseGuards(JwtOptionalGuard, TerminalAccessGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mutate terminal local state' })
  mutateState(@Param('id') id: string, @Body() dto: MutateStateDto) {
    return this.stateService.mutateTerminalState(id, dto.mutations);
  }

  @Post('terminals/:id/state/reset')
  @HttpCode(200)
  @UseGuards(JwtOptionalGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reset all terminal local state (admin)' })
  resetState(@Param('id') id: string) {
    return this.stateService.resetTerminalState(id);
  }

  @Post('terminals/:id/state/:key/reset')
  @HttpCode(200)
  @UseGuards(JwtOptionalGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reset single terminal state variable (admin)' })
  resetStateKey(@Param('id') id: string, @Param('key') key: string) {
    return this.stateService.resetTerminalStateKey(id, key);
  }
}
