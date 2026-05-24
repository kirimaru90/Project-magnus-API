import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument } from './schemas/user.schema';
import {
  Campaign,
  CampaignDocument,
} from '../campaigns/schemas/campaign.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const BCRYPT_ROUNDS = 12;

function toResponse(user: User & { _id: unknown }) {
  return {
    id: String(user._id),
    username: user.username,
    role: user.role,
    createdAt: user.createdAt,
  };
}

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Campaign.name) private campaignModel: Model<CampaignDocument>,
  ) {}

  async list() {
    const users = await this.userModel.find().lean();
    return users.map(toResponse);
  }

  async findById(id: string) {
    const user = await this.userModel.findById(id).lean();
    if (!user) throw new NotFoundException('User not found');
    return toResponse(user);
  }

  async create(dto: CreateUserDto) {
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    try {
      const user = await this.userModel.create({
        username: dto.username,
        passwordHash,
        role: dto.role,
      });
      return toResponse(user.toObject());
    } catch (err: unknown) {
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictException('Username already exists');
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateUserDto) {
    const patch: Partial<{
      username: string;
      passwordHash: string;
      role: string;
    }> = {};
    if (dto.username) patch.username = dto.username;
    if (dto.role) patch.role = dto.role;
    if (dto.password)
      patch.passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const user = await this.userModel
      .findByIdAndUpdate(id, { $set: patch }, { new: true })
      .lean();
    if (!user) throw new NotFoundException('User not found');
    return toResponse(user);
  }

  async existsByUsername(username: string): Promise<boolean> {
    const user = await this.userModel.findOne({ username }).lean();
    return user !== null;
  }

  async delete(id: string, callerId: string) {
    if (id === callerId)
      throw new ConflictException('Cannot delete your own account');
    const user = await this.userModel.findByIdAndDelete(id).lean();
    if (!user) throw new NotFoundException('User not found');
    await this.campaignModel.updateMany({}, { $pull: { players: user._id } });
    return;
  }
}
