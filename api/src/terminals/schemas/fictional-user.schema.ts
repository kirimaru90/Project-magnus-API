import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type FictionalUserDocument = FictionalUser & Document;

@Schema()
export class FictionalUser {
  @Prop({ required: true, type: Types.ObjectId, index: true })
  terminalId: Types.ObjectId;

  @Prop({ required: true })
  username: string;

  @Prop({ required: true })
  password: string;
}

export const FictionalUserSchema = SchemaFactory.createForClass(FictionalUser);
FictionalUserSchema.index({ terminalId: 1, username: 1 }, { unique: true });
