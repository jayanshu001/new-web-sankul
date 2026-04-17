import mongoose, { Schema, Document } from "mongoose";

export interface IVideoCategoryRelation extends Document {
  parent: mongoose.Types.ObjectId;
  child: mongoose.Types.ObjectId;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const videoCategoryRelationSchema: Schema = new Schema(
  {
    parent: { type: Schema.Types.ObjectId, ref: "VideoCategory", required: true },
    child: { type: Schema.Types.ObjectId, ref: "VideoCategory", required: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

videoCategoryRelationSchema.index({ parent: 1, child: 1 }, { unique: true });

export const VideoCategoryRelation = mongoose.model<IVideoCategoryRelation>(
  "VideoCategoryRelation",
  videoCategoryRelationSchema,
  "ws_video_category_relations"
);
