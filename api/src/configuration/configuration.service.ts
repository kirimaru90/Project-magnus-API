import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Campaign,
  CampaignDocument,
} from '../campaigns/schemas/campaign.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { AuthenticatedUser } from '../auth/jwt.strategy';

const MAX_SIZE_BYTES = 16 * 1024;
const MAX_DEPTH = 8;
const ALLOWED_DOMAINS = new Set(['terminal']);

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function measureDepth(val: unknown, current = 0): number {
  if (!isPlainObject(val)) return current;
  const values = Object.values(val);
  if (values.length === 0) return current;
  return Math.max(...values.map((v) => measureDepth(v, current + 1)));
}

function deepMerge(
  lower: Record<string, unknown>,
  higher: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...lower };
  for (const [key, higherVal] of Object.entries(higher)) {
    const lowerVal = result[key];
    if (isPlainObject(higherVal) && isPlainObject(lowerVal)) {
      result[key] = deepMerge(lowerVal, higherVal);
    } else {
      result[key] = higherVal;
    }
  }
  return result;
}

@Injectable()
export class ConfigurationService {
  constructor(
    @InjectModel(Campaign.name) private campaignModel: Model<CampaignDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  private validateEnvelope(body: unknown): void {
    if (!isPlainObject(body)) {
      throw new BadRequestException(
        'Configuration body must be a plain JSON object',
      );
    }
    const serialized = JSON.stringify(body);
    if (serialized.length > MAX_SIZE_BYTES) {
      throw new BadRequestException(
        `Configuration body must not exceed ${MAX_SIZE_BYTES} bytes`,
      );
    }
    if (measureDepth(body) > MAX_DEPTH) {
      throw new BadRequestException(
        `Configuration body nesting must not exceed depth ${MAX_DEPTH}`,
      );
    }
  }

  private validateDomain(domain: string): void {
    if (!ALLOWED_DOMAINS.has(domain)) {
      throw new BadRequestException(
        `Unknown configuration domain: ${domain}. Allowed: ${[...ALLOWED_DOMAINS].join(', ')}`,
      );
    }
  }

  async getCampaignConfiguration(
    campaignId: string,
    actor?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    const campaign = await this.campaignModel.findById(campaignId).lean();
    const campaignLayer = campaign?.configuration ?? {};

    if (!actor) return campaignLayer;

    const user = await this.userModel.findById(actor.id).lean();
    const userLayer = user?.configuration ?? {};

    return deepMerge(campaignLayer, userLayer);
  }

  async setCampaignDomain(
    id: string,
    domain: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    this.validateDomain(domain);
    this.validateEnvelope(body);

    const updated = await this.campaignModel
      .findByIdAndUpdate(
        id,
        { $set: { [`configuration.${domain}`]: body } },
        { new: true },
      )
      .lean();

    return updated?.configuration ?? {};
  }

  async getUserConfiguration(userId: string): Promise<Record<string, unknown>> {
    const user = await this.userModel.findById(userId).lean();
    return user?.configuration ?? {};
  }

  async setUserDomain(
    userId: string,
    domain: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    this.validateDomain(domain);
    this.validateEnvelope(body);

    const updated = await this.userModel
      .findByIdAndUpdate(
        userId,
        { $set: { [`configuration.${domain}`]: body } },
        { new: true },
      )
      .lean();

    return updated?.configuration ?? {};
  }
}
