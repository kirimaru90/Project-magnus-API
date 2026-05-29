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
import { User, UserDocument } from '../../users/schemas/user.schema';
import { AuthenticatedUser } from '../../auth/jwt.strategy';

@Injectable()
export class TerminalAccessGuard implements CanActivate {
  constructor(
    @InjectModel(Terminal.name) private terminalModel: Model<TerminalDocument>,
    @InjectModel(Campaign.name) private campaignModel: Model<CampaignDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
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

    // Campaign-level access check
    if (user?.role !== 'admin') {
      if (!campaign.isActive) throw new NotFoundException();
      if (!campaign.isPublic) {
        if (user?.role !== 'player') throw new NotFoundException();
        const isMember = campaign.players.some(
          (pid) => pid.toString() === user.id,
        );
        if (!isMember) throw new NotFoundException();
      }
    }

    // Admin passes all further checks
    if (user?.role === 'admin') return true;

    // Privacy check: non-public terminals require an unlock
    const meta = terminal.content?.meta as Record<string, unknown> | undefined;
    const isPublic = meta?.public === true;
    if (isPublic) return true;

    // Non-public terminal — player must have the hiddenId unlocked
    if (!user) throw new NotFoundException();
    const hiddenId = meta?.hiddenId;
    if (typeof hiddenId !== 'string' || !hiddenId)
      throw new NotFoundException();

    const userDoc = await this.userModel
      .findById(user.id)
      .select('unlockedHiddenIds')
      .lean();
    if (!userDoc) throw new NotFoundException();

    const campaignId = String(terminal.campaignId);
    const unlocks: string[] =
      userDoc.unlockedHiddenIds instanceof Map
        ? (userDoc.unlockedHiddenIds.get(campaignId) ?? [])
        : ((userDoc.unlockedHiddenIds as unknown as Record<string, string[]>)?.[
            campaignId
          ] ?? []);

    if (!unlocks.includes(hiddenId)) throw new NotFoundException();
    return true;
  }
}
