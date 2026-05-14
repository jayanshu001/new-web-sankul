import mongoose, { Schema, Document } from "mongoose";
import { VideoType } from "../enums";

export type VideoPlatform = "youtube" | "aws" | "vimeo";

export interface IVideo extends Document {
  videoCategoryId: mongoose.Types.ObjectId;
  // Set when this Video was promoted from a Streamos live-session recording.
  // Lets us trace a recorded lecture back to the session it came from (and
  // list, per session, everywhere a recording has been filed). null for
  // ordinary manually-added videos.
  liveSessionId?: mongoose.Types.ObjectId | null;
  title?: string;
  topic?: string;
  slug?: string;
  platform: VideoPlatform;
  priceType: VideoType;
  youtube_id?: string;
  aws_id?: string;
  vimeo_id?: string;
  order: number;
  status: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const videoSchema: Schema = new Schema(
  {
    videoCategoryId: { type: Schema.Types.ObjectId, ref: "VideoCategory", required: true },
    liveSessionId: { type: Schema.Types.ObjectId, ref: "LiveSession", default: null, index: true },
    title: { type: String, default: "" },
    topic: { type: String, default: "" },
    slug: { type: String, default: "" },
    platform: { type: String, enum: ["youtube", "aws", "vimeo"], required: true },
    priceType: { type: String, enum: ["free", "paid"], default: "paid" },
    youtube_id: { type: String, default: null },
    aws_id: { type: String, default: null },
    vimeo_id: { type: String, default: null },
    order: { type: Number, default: 0 },
    status: { type: Boolean, default: true },
  },
  { timestamps: true }
);

videoSchema.index({ videoCategoryId: 1, status: 1, order: 1 });

export const Video = mongoose.model<IVideo>("Video", videoSchema, "ws_videos");
