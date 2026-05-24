import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CampaignsService } from './campaigns.service';
import { CampaignsController } from './campaigns.controller';
import { Campaign, CampaignSchema } from './schemas/campaign.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Terminal, TerminalSchema } from '../terminals/schemas/terminal.schema';
import {
  FictionalUser,
  FictionalUserSchema,
} from '../terminals/schemas/fictional-user.schema';
import { CampaignAccessGuard } from '../common/guards/campaign-access.guard';
import { CampaignStateController } from './campaign-state.controller';
import { CampaignConfigurationController } from './campaign-configuration.controller';
import { StateModule } from '../state/state.module';
import { ConfigurationModule } from '../configuration/configuration.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Campaign.name, schema: CampaignSchema },
      { name: User.name, schema: UserSchema },
      { name: Terminal.name, schema: TerminalSchema },
      { name: FictionalUser.name, schema: FictionalUserSchema },
    ]),
    StateModule,
    ConfigurationModule,
  ],
  providers: [CampaignsService, CampaignAccessGuard],
  controllers: [
    CampaignsController,
    CampaignStateController,
    CampaignConfigurationController,
  ],
  exports: [CampaignsService, CampaignAccessGuard],
})
export class CampaignsModule {}
