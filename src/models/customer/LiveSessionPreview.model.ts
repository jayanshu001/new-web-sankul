import mongoose, { Schema, Document } from "mongoose";

export interface ILiveSessionPreview extends Document {
  customerId: mongoose.Types.ObjectId;
  liveSessionId: mongoose.Types.ObjectId;
  startedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const liveSessionPreviewSchema: Schema = new Schema(
  {
    customerId:    { type: Schema.Types.ObjectId, ref: "Customer",    required: true },
    liveSessionId: { type: Schema.Types.ObjectId, ref: "LiveSession", required: true },
    // When this customer first opened the session. Their personal 3-minute
    // preview window is measured from here. Written once via $setOnInsert and
    // never moved, so a non-subscriber can't reset the trial by re-requesting
    // the session.
    startedAt:     { type: Date, required: true },
  },
  { timestamps: true, collection: "ws_live_session_previews" }
);

// One preview clock per (customer, session). Also the dedupe key for the
// upsert in resolveLivePreviewState.
liveSessionPreviewSchema.index({ customerId: 1, liveSessionId: 1 }, { unique: true });

export const LiveSessionPreview = mongoose.model<ILiveSessionPreview>(
  "LiveSessionPreview",
  liveSessionPreviewSchema
);
