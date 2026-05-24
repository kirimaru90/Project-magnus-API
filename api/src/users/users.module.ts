import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { UserConfigurationController } from './user-configuration.controller';
import { BootstrapService } from './bootstrap.service';
import { User, UserSchema } from './schemas/user.schema';
import { Campaign, CampaignSchema } from '../campaigns/schemas/campaign.schema';
import { ConfigurationModule } from '../configuration/configuration.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Campaign.name, schema: CampaignSchema },
    ]),
    ConfigurationModule,
  ],
  providers: [UsersService, BootstrapService],
  controllers: [UsersController, UserConfigurationController],
  exports: [UsersService],
})
export class UsersModule {}
