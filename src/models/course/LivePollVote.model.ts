import { Schema, model, Document, Types } from "mongoose";

export interface ILivePollVote extends Document {
  pollId: Types.ObjectId;
  customerId: Types.ObjectId;
  optionIndex: number;
  createdAt: Date;
}

const LivePollVoteSchema = new Schema<ILivePollVote>(
  {
    pollId: { type: Schema.Types.ObjectId, ref: "LivePoll", required: true },
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    optionIndex: { type: Number, required: true, min: 0 },
  },
  { collection: "ws_live_poll_votes", timestamps: true }
);

// One vote per customer per poll
LivePollVoteSchema.index({ pollId: 1, customerId: 1 }, { unique: true });

export const LivePollVote = model<ILivePollVote>("LivePollVote", LivePollVoteSchema);
