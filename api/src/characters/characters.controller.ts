import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CharactersService } from './characters.service';
import { JwtRequiredGuard } from '../common/guards/jwt-required.guard';
import { CampaignAccessGuard } from '../common/guards/campaign-access.guard';
import { CharacterOwnerGuard } from '../common/guards/character-owner.guard';
import { AuthenticatedUser } from '../auth/jwt.strategy';
import { CreateCharacterDto } from './dto/create-character.dto';
import { UpdateCharacterDto } from './dto/update-character.dto';
import { PatchSpecialDto } from './dto/patch-special.dto';
import { PatchSkillsDto } from './dto/patch-skills.dto';
import { PatchPerksDto } from './dto/patch-perks.dto';
import { PatchStatusDto } from './dto/patch-status.dto';
import { PatchActionPointsDto } from './dto/patch-action-points.dto';
import { PatchInventoryDto } from './dto/patch-inventory.dto';
import { PatchResourcesDto } from './dto/patch-resources.dto';

@ApiTags('characters')
@ApiBearerAuth()
@Controller('campaigns/:campaignId/characters')
@UseGuards(JwtRequiredGuard, CampaignAccessGuard)
export class CharactersController {
  constructor(private readonly charactersService: CharactersService) {}

  // --- CRUD ---

  @Get()
  @ApiOperation({ summary: 'List characters in campaign (actor-scoped)' })
  list(
    @Param('campaignId') campaignId: string,
    @Request() req: { user: AuthenticatedUser },
  ) {
    return this.charactersService.list(campaignId, req.user);
  }

  @Post()
  @ApiOperation({ summary: 'Create character' })
  create(
    @Param('campaignId') campaignId: string,
    @Body() dto: CreateCharacterDto,
    @Request() req: { user: AuthenticatedUser },
  ) {
    return this.charactersService.create(campaignId, dto, req.user);
  }

  @Get(':characterId')
  @UseGuards(CharacterOwnerGuard)
  @ApiOperation({ summary: 'Get character detail' })
  findById(
    @Param('campaignId') campaignId: string,
    @Param('characterId') characterId: string,
  ) {
    return this.charactersService.findById(campaignId, characterId);
  }

  @Put(':characterId')
  @UseGuards(CharacterOwnerGuard)
  @ApiOperation({ summary: 'Full character update' })
  update(
    @Param('campaignId') campaignId: string,
    @Param('characterId') characterId: string,
    @Body() dto: UpdateCharacterDto,
    @Request() req: { user: AuthenticatedUser },
  ) {
    return this.charactersService.update(
      campaignId,
      characterId,
      dto,
      req.user,
    );
  }

  @Delete(':characterId')
  @UseGuards(CharacterOwnerGuard)
  @ApiOperation({ summary: 'Soft-delete character' })
  softDelete(
    @Param('campaignId') campaignId: string,
    @Param('characterId') characterId: string,
  ) {
    return this.charactersService.softDelete(campaignId, characterId);
  }

  // --- Section patches (return only the mutated section) ---

  @Patch(':characterId/special')
  @UseGuards(CharacterOwnerGuard)
  @ApiOperation({ summary: 'Patch SPECIAL stats (admin-only writes)' })
  patchSpecial(
    @Param('campaignId') campaignId: string,
    @Param('characterId') characterId: string,
    @Body() dto: PatchSpecialDto,
    @Request() req: { user: AuthenticatedUser },
  ) {
    return this.charactersService.patchSpecial(
      campaignId,
      characterId,
      dto,
      req.user,
    );
  }

  @Patch(':characterId/skills')
  @UseGuards(CharacterOwnerGuard)
  @ApiOperation({ summary: 'Patch skills (admin-only writes)' })
  patchSkills(
    @Param('campaignId') campaignId: string,
    @Param('characterId') characterId: string,
    @Body() dto: PatchSkillsDto,
    @Request() req: { user: AuthenticatedUser },
  ) {
    return this.charactersService.patchSkills(
      campaignId,
      characterId,
      dto,
      req.user,
    );
  }

  @Patch(':characterId/perks')
  @UseGuards(CharacterOwnerGuard)
  @ApiOperation({ summary: 'Patch perks (admin-only writes)' })
  patchPerks(
    @Param('campaignId') campaignId: string,
    @Param('characterId') characterId: string,
    @Body() dto: PatchPerksDto,
    @Request() req: { user: AuthenticatedUser },
  ) {
    return this.charactersService.patchPerks(
      campaignId,
      characterId,
      dto,
      req.user,
    );
  }

  @Patch(':characterId/status')
  @UseGuards(CharacterOwnerGuard)
  @ApiOperation({ summary: 'Patch status (conditions + criticalState)' })
  patchStatus(
    @Param('campaignId') campaignId: string,
    @Param('characterId') characterId: string,
    @Body() dto: PatchStatusDto,
    @Request() req: { user: AuthenticatedUser },
  ) {
    return this.charactersService.patchStatus(
      campaignId,
      characterId,
      dto,
      req.user,
    );
  }

  @Patch(':characterId/action-points')
  @UseGuards(CharacterOwnerGuard)
  @ApiOperation({ summary: 'Patch action points' })
  patchActionPoints(
    @Param('campaignId') campaignId: string,
    @Param('characterId') characterId: string,
    @Body() dto: PatchActionPointsDto,
    @Request() req: { user: AuthenticatedUser },
  ) {
    return this.charactersService.patchActionPoints(
      campaignId,
      characterId,
      dto,
      req.user,
    );
  }

  @Patch(':characterId/inventory')
  @UseGuards(CharacterOwnerGuard)
  @ApiOperation({ summary: 'Patch inventory items' })
  patchInventory(
    @Param('campaignId') campaignId: string,
    @Param('characterId') characterId: string,
    @Body() dto: PatchInventoryDto,
    @Request() req: { user: AuthenticatedUser },
  ) {
    return this.charactersService.patchInventory(
      campaignId,
      characterId,
      dto,
      req.user,
    );
  }

  @Patch(':characterId/resources')
  @UseGuards(CharacterOwnerGuard)
  @ApiOperation({ summary: 'Patch resource counters' })
  patchResources(
    @Param('campaignId') campaignId: string,
    @Param('characterId') characterId: string,
    @Body() dto: PatchResourcesDto,
    @Request() req: { user: AuthenticatedUser },
  ) {
    return this.charactersService.patchResources(
      campaignId,
      characterId,
      dto,
      req.user,
    );
  }
}
