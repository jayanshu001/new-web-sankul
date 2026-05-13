import mongoose, { Schema, Document } from "mongoose";

export interface IVideoCategory extends Document {
  title: string;
  slug: string;
  image: string;
  courseId?: mongoose.Types.ObjectId;
  liveCourseId?: mongoose.Types.ObjectId;
  childCategoryId?: mongoose.Types.ObjectId;
  educatorId?: mongoose.Types.ObjectId;
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
    courseId: { type: Schema.Types.ObjectId, ref: "Course", default: null, index: true },
    liveCourseId: { type: Schema.Types.ObjectId, ref: "LiveCourse", default: null, index: true },
    childCategoryId: { type: Schema.Types.ObjectId, ref: "VideoCategory", default: null },
    educatorId: { type: Schema.Types.ObjectId, ref: "CourseEducator", default: null },
    order_by: { type: Number, default: 0 },
    status: { type: Boolean, default: true },
  },
  {
    timestamps: true,
  }
);

export const VideoCategory = mongoose.model<IVideoCategory>("VideoCategory", videoCategorySchema, "ws_video_categories");
