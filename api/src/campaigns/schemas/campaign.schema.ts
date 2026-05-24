import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type CampaignDocument = Campaign & Document;

export interface StateEntry {
  type: 'boolean' | 'number' | 'enum' | 'string';
  value: unknown;
  default: unknown;
  values?: string[];
}

@Schema({ timestamps: true })
export class Campaign {
  @Prop({ required: true })
  name: string;

  @Prop({ default: false, index: true })
  isActive: boolean;

  @Prop({ default: false, index: true })
  isPublic: boolean;

  @Prop({ type: [Types.ObjectId], default: [] })
  players: Types.ObjectId[];

  @Prop({ type: Map, of: Object, default: {} })
  state: Map<string, StateEntry>;

  @Prop({ type: Object, default: {} })
  configuration: Record<string, unknown>;

  createdAt: Date;
  updatedAt: Date;
}

export const CampaignSchema = SchemaFactory.createForClass(Campaign);
CampaignSchema.index({ isActive: 1, isPublic: 1 });
