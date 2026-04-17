import mongoose, { Schema, Document } from "mongoose";

export interface IVideoCategory extends Document {
  title: string;
  slug: string;
  image: string;
  courseId?: mongoose.Types.ObjectId;
  order_by: number;
  status: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const videoCategorySchema: Schema = new Schema(
  {
    title: { type: String, required: true },
    slug: { type: String, required: true },
    image: { type: String, required: true },
    courseId: { type: Schema.Types.ObjectId, ref: "Course", default: null },
    order_by: { type: Number, default: 0 },
    status: { type: Boolean, default: true },
  },
  {
    timestamps: true,
  }
);

export const VideoCategory = mongoose.model<IVideoCategory>("VideoCategory", videoCategorySchema, "ws_video_categories");
