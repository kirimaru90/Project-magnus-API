import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  Campaign,
  CampaignDocument,
} from '../campaigns/schemas/campaign.schema';

const INVALID_CREDENTIALS = 'Invalid credentials';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Campaign.name) private campaignModel: Model<CampaignDocument>,
    private jwtService: JwtService,
  ) {}

  async login(username: string, password: string) {
    const user = await this.userModel.findOne({ username }).lean();
    if (!user) throw new UnauthorizedException(INVALID_CREDENTIALS);

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) throw new UnauthorizedException(INVALID_CREDENTIALS);

    const token = this.jwtService.sign({
      sub: String(user._id),
      role: user.role,
    });
    return { accessToken: token, role: user.role, expiresIn: 86400 };
  }

  async me(userId: string) {
    const user = await this.userModel
      .findById(userId)
      .select('-passwordHash')
      .lean();
    if (!user) throw new UnauthorizedException(INVALID_CREDENTIALS);

    let lastCampaignId = user.lastCampaignId ?? null;
    if (lastCampaignId !== null) {
      const exists = await this.campaignModel.exists({ _id: lastCampaignId });
      if (!exists) {
        await this.userModel.updateOne(
          { _id: user._id },
          { $set: { lastCampaignId: null } },
        );
        lastCampaignId = null;
      }
    }

    const rawUnlocks = user.unlockedHiddenIds;
    const unlockedHiddenIds: Record<string, string[]> =
      rawUnlocks instanceof Map
        ? Object.fromEntries(rawUnlocks)
        : (rawUnlocks ?? {});

    return {
      id: String(user._id),
      username: user.username,
      role: user.role,
      lastCampaignId,
      unlockedHiddenIds,
    };
  }
}
