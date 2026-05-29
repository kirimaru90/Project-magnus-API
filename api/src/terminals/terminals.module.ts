import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TerminalsService } from './terminals.service';
import { TerminalsController } from './terminals.controller';
import { Terminal, TerminalSchema } from './schemas/terminal.schema';
import {
  FictionalUser,
  FictionalUserSchema,
} from './schemas/fictional-user.schema';
import { Campaign, CampaignSchema } from '../campaigns/schemas/campaign.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { CampaignAccessGuard } from '../common/guards/campaign-access.guard';
import { TerminalAccessGuard } from '../common/guards/terminal-access.guard';
import { StateModule } from '../state/state.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Terminal.name, schema: TerminalSchema },
      { name: FictionalUser.name, schema: FictionalUserSchema },
      { name: Campaign.name, schema: CampaignSchema },
      { name: User.name, schema: UserSchema },
    ]),
    StateModule,
  ],
  providers: [TerminalsService, CampaignAccessGuard, TerminalAccessGuard],
  controllers: [TerminalsController],
  exports: [TerminalsService],
})
export class TerminalsModule {}
