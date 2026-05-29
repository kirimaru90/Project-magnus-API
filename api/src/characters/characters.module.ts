import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CharactersService } from './characters.service';
import { CharactersController } from './characters.controller';
import { Character, CharacterSchema } from './schemas/character.schema';
import { Campaign, CampaignSchema } from '../campaigns/schemas/campaign.schema';
import { CharacterOwnerGuard } from '../common/guards/character-owner.guard';
import { CampaignAccessGuard } from '../common/guards/campaign-access.guard';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Character.name, schema: CharacterSchema },
      { name: Campaign.name, schema: CampaignSchema },
    ]),
  ],
  providers: [CharactersService, CharacterOwnerGuard, CampaignAccessGuard],
  controllers: [CharactersController],
})
export class CharactersModule {}
