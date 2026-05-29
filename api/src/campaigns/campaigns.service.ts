import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Campaign, CampaignDocument } from './schemas/campaign.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  Terminal,
  TerminalDocument,
} from '../terminals/schemas/terminal.schema';
import {
  FictionalUser,
  FictionalUserDocument,
} from '../terminals/schemas/fictional-user.schema';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { AuthenticatedUser } from '../auth/jwt.strategy';

function toResponse(
  campaign: Campaign & { _id: unknown },
  actor?: AuthenticatedUser,
) {
  const base = {
    id: String((campaign as { _id: unknown })._id),
    name: campaign.name,
    isActive: campaign.isActive,
    isPublic: campaign.isPublic,
    state:
      campaign.state instanceof Map
        ? Object.fromEntries(campaign.state)
        : ((campaign.state as unknown as Record<string, unknown>) ?? {}),
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
  };
  if (actor?.role === 'admin') {
    return { ...base, players: campaign.players.map(String) };
  }
  return { ...base, players: [] };
}

function isVisible(campaign: Campaign, actor?: AuthenticatedUser): boolean {
  if (actor?.role === 'admin') return true;
  if (!campaign.isActive) return false;
  if (campaign.isPublic) return true;
  if (actor?.role === 'player') {
    return campaign.players.some((pid) => pid.toString() === actor.id);
  }
  return false;
}

@Injectable()
export class CampaignsService {
  constructor(
    @InjectModel(Campaign.name) private campaignModel: Model<CampaignDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Terminal.name) private terminalModel: Model<TerminalDocument>,
    @InjectModel(FictionalUser.name)
    private fictionalUserModel: Model<FictionalUserDocument>,
  ) {}

  async list(actor?: AuthenticatedUser) {
    const campaigns = await this.campaignModel.find().lean();
    return campaigns
      .filter((c) => isVisible(c, actor))
      .map((c) => toResponse(c, actor));
  }

  async findById(id: string, actor?: AuthenticatedUser) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const campaign = await this.campaignModel.findById(id).lean();
    if (!campaign || !isVisible(campaign, actor)) throw new NotFoundException();
    return toResponse(campaign, actor);
  }

  async create(dto: CreateCampaignDto) {
    const campaign = await this.campaignModel.create({
      name: dto.name,
      isActive: dto.isActive ?? false,
      isPublic: dto.isPublic ?? false,
      players: [],
      state: new Map(),
    });
    return toResponse(campaign.toObject(), { id: '', role: 'admin' });
  }

  async update(id: string, dto: UpdateCampaignDto) {
    const campaign = await this.campaignModel
      .findByIdAndUpdate(id, { $set: dto }, { new: true })
      .lean();
    if (!campaign) throw new NotFoundException();
    return toResponse(campaign, { id: '', role: 'admin' });
  }

  async delete(id: string) {
    const campaign = await this.campaignModel.findByIdAndDelete(id).lean();
    if (!campaign) throw new NotFoundException();
    const terminals = await this.terminalModel
      .find({ campaignId: campaign._id })
      .lean();
    const terminalIds = terminals.map((t) => t._id);
    await this.terminalModel.deleteMany({ campaignId: campaign._id });
    if (terminalIds.length > 0) {
      await this.fictionalUserModel.deleteMany({
        terminalId: { $in: terminalIds },
      });
    }
    const campaignId = String(campaign._id);
    await this.userModel.updateMany(
      { lastCampaignId: campaignId },
      { $set: { lastCampaignId: null } },
    );
    await this.userModel.updateMany(
      {},
      { $unset: { [`unlockedHiddenIds.${campaignId}`]: '' } },
    );
  }

  async toggleActive(id: string) {
    const campaign = await this.campaignModel.findById(id).lean();
    if (!campaign) throw new NotFoundException();
    const updated = await this.campaignModel
      .findByIdAndUpdate(
        id,
        { $set: { isActive: !campaign.isActive } },
        { new: true },
      )
      .lean();
    return toResponse(updated!, { id: '', role: 'admin' });
  }

  async listPlayers(id: string) {
    const campaign = await this.campaignModel.findById(id).lean();
    if (!campaign) throw new NotFoundException();
    const users = await this.userModel
      .find({ _id: { $in: campaign.players } })
      .lean();
    return users.map((u) => ({
      id: String(u._id),
      username: u.username,
      role: u.role,
    }));
  }

  async addPlayer(id: string, playerId: string) {
    if (!Types.ObjectId.isValid(playerId))
      throw new BadRequestException('Invalid player id');
    const user = await this.userModel.findById(playerId).lean();
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== 'player')
      throw new BadRequestException('User must have player role');

    const campaign = await this.campaignModel
      .findByIdAndUpdate(
        id,
        { $addToSet: { players: new Types.ObjectId(playerId) } },
        { new: true },
      )
      .lean();
    if (!campaign) throw new NotFoundException();
    return { id: String(user._id), username: user.username, role: user.role };
  }

  async removePlayer(id: string, playerId: string) {
    const campaign = await this.campaignModel
      .findByIdAndUpdate(id, {
        $pull: { players: new Types.ObjectId(playerId) },
      })
      .lean();
    if (!campaign) throw new NotFoundException();
  }
}
