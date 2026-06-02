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
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { AddPlayerDto } from './dto/add-player.dto';
import { JwtOptionalGuard } from '../common/guards/jwt-optional.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { CampaignAccessGuard } from '../common/guards/campaign-access.guard';
import { AuthenticatedUser } from '../auth/jwt.strategy';

@ApiTags('campaigns')
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  @UseGuards(JwtOptionalGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List campaigns (actor-dependent)' })
  list(@Request() req: { user?: AuthenticatedUser }) {
    return this.campaignsService.list(req.user);
  }

  @Post()
  @UseGuards(JwtOptionalGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create campaign (admin)' })
  create(@Body() dto: CreateCampaignDto) {
    return this.campaignsService.create(dto);
  }

  @Get(':id')
  @UseGuards(JwtOptionalGuard, CampaignAccessGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get campaign detail' })
  findById(
    @Param('id') id: string,
    @Request() req: { user?: AuthenticatedUser },
  ) {
    return this.campaignsService.findById(id, req.user);
  }

  @Put(':id')
  @UseGuards(JwtOptionalGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update campaign (admin)' })
  update(@Param('id') id: string, @Body() dto: UpdateCampaignDto) {
    return this.campaignsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(JwtOptionalGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete campaign + cascade (admin)' })
  delete(@Param('id') id: string) {
    return this.campaignsService.delete(id);
  }

  @Post(':id/activate')
  @UseGuards(JwtOptionalGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Toggle campaign isActive (admin)' })
  toggleActive(@Param('id') id: string) {
    return this.campaignsService.toggleActive(id);
  }

  // --- Player membership ---

  @Get(':id/players')
  @UseGuards(JwtOptionalGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List players assigned to campaign (admin)' })
  listPlayers(@Param('id') id: string) {
    return this.campaignsService.listPlayers(id);
  }

  @Post(':id/players')
  @UseGuards(JwtOptionalGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Assign player to campaign (admin)' })
  addPlayer(@Param('id') id: string, @Body() dto: AddPlayerDto) {
    return this.campaignsService.addPlayer(id, dto.playerId);
  }

  @Delete(':id/players/:playerId')
  @HttpCode(204)
  @UseGuards(JwtOptionalGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove player from campaign (admin)' })
  removePlayer(@Param('id') id: string, @Param('playerId') playerId: string) {
    return this.campaignsService.removePlayer(id, playerId);
  }
}
