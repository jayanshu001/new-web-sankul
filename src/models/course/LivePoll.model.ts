import { Schema, model, Document, Types } from "mongoose";

export interface IPollOption {
  text: string;
  votes: number;
}

export interface ILivePoll extends Document {
  liveClassId: string;
  question: string;
  options: IPollOption[];
  totalVotes: number;
  isActive: boolean;
  createdBy: Types.ObjectId;
  createdByName: string;
  closedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PollOptionSchema = new Schema<IPollOption>(
  {
    text: { type: String, required: true, maxlength: 300 },
    votes: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const LivePollSchema = new Schema<ILivePoll>(
  {
    liveClassId: { type: String, required: true, index: true },
    question: { type: String, required: true, maxlength: 1000 },
    options: { type: [PollOptionSchema], required: true },
    totalVotes: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "AdminUser", required: true },
    createdByName: { type: String, required: true },
    closedAt: { type: Date },
  },
  { collection: "ws_live_polls", timestamps: true }
);

LivePollSchema.index({ liveClassId: 1, isActive: 1 });

export const LivePoll = model<ILivePoll>("LivePoll", LivePollSchema);
