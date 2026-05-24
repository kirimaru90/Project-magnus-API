import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StateService } from './state.service';
import { Campaign, CampaignSchema } from '../campaigns/schemas/campaign.schema';
import { Terminal, TerminalSchema } from '../terminals/schemas/terminal.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Campaign.name, schema: CampaignSchema },
      { name: Terminal.name, schema: TerminalSchema },
    ]),
  ],
  providers: [StateService],
  exports: [StateService],
})
export class StateModule {}
