import mongoose, { Schema, Document } from "mongoose";

export type VideoPlatform = "youtube" | "aws" | "vimeo";

export interface IVideo extends Document {
  videoCategoryId: mongoose.Types.ObjectId;
  title?: string;
  platform: VideoPlatform;
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
    title: { type: String, default: "" },
    platform: { type: String, enum: ["youtube", "aws", "vimeo"], required: true },
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
