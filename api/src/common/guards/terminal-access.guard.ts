import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Terminal,
  TerminalDocument,
} from '../../terminals/schemas/terminal.schema';
import {
  Campaign,
  CampaignDocument,
} from '../../campaigns/schemas/campaign.schema';
import { AuthenticatedUser } from '../../auth/jwt.strategy';

@Injectable()
export class TerminalAccessGuard implements CanActivate {
  constructor(
    @InjectModel(Terminal.name) private terminalModel: Model<TerminalDocument>,
    @InjectModel(Campaign.name) private campaignModel: Model<CampaignDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
      params: { id?: string };
    }>();
    const terminalId = req.params.id;
    if (!terminalId || !Types.ObjectId.isValid(terminalId))
      throw new NotFoundException();

    const terminal = await this.terminalModel.findById(terminalId).lean();
    if (!terminal) throw new NotFoundException();

    const campaign = await this.campaignModel
      .findById(terminal.campaignId)
      .lean();
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
