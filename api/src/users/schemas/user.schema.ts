import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

export type UserRole = 'admin' | 'player';

@Schema({ timestamps: { createdAt: 'createdAt', updatedAt: false } })
export class User {
  @Prop({ required: true, unique: true, trim: true })
  username: string;

  @Prop({ required: true })
  passwordHash: string;

  @Prop({ required: true, enum: ['admin', 'player'] })
  role: UserRole;

  @Prop({ type: Object, default: {} })
  configuration: Record<string, unknown>;

  @Prop({ type: String, default: null })
  lastCampaignId: string | null;

  @Prop({ type: Map, of: [String], default: {} })
  unlockedHiddenIds: Map<string, string[]>;

  @Prop()
  createdAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
