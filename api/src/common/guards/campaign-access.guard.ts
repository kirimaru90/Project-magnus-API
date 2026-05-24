import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Campaign,
  CampaignDocument,
} from '../../campaigns/schemas/campaign.schema';
import { AuthenticatedUser } from '../../auth/jwt.strategy';

@Injectable()
export class CampaignAccessGuard implements CanActivate {
  constructor(
    @InjectModel(Campaign.name) private campaignModel: Model<CampaignDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
      params: { id?: string; campaignId?: string };
    }>();
    const id = req.params.id ?? req.params.campaignId;
    if (!id || !Types.ObjectId.isValid(id)) throw new NotFoundException();

    const campaign = await this.campaignModel.findById(id).lean();
    if (!campaign) throw new NotFoundException();

    const user = req.user;

    if (user?.role === 'admin') return true;

    if (campaign.isActive && campaign.isPublic) return true;

    if (user?.role === 'player' && campaign.isActive) {
      const isMember = campaign.players.some(
        (pid) => pid.toString() === user.id,
      );
      if (isMember) return true;
    }

    throw new NotFoundException();
  }
}
