import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { StateEntry } from '../../campaigns/schemas/campaign.schema';

export type TerminalDocument = Terminal & Document;

@Schema({ timestamps: true })
export class Terminal {
  @Prop({ required: true, type: Types.ObjectId, index: true })
  campaignId: Types.ObjectId;

  @Prop({ required: true })
  title: string;

  @Prop({ type: Object, required: true })
  content: Record<string, unknown>;

  @Prop({ type: Map, of: Object, default: {} })
  state: Map<string, StateEntry>;

  @Prop({ type: Number, default: 0 })
  viewCount: number;

  createdAt: Date;
  updatedAt: Date;
}

export const TerminalSchema = SchemaFactory.createForClass(Terminal);
TerminalSchema.index(
  { campaignId: 1, 'content.meta.hiddenId': 1 },
  {
    unique: true,
    partialFilterExpression: { 'content.meta.hiddenId': { $type: 'string' } },
  },
);
