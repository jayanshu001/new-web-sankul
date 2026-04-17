import mongoose, { Schema, Document } from "mongoose";

export interface ICourse extends Document {
  name: string;
  description: string;
  image: string;
  ordered: number;
  shareableLink?: string;
  withMaterial?: string;
  withoutMaterial?: string;
  level: string;
  status: boolean;
  
  // Relations
  courseEducatorId?: mongoose.Types.ObjectId;
  courseSubjectCategoryId?: mongoose.Types.ObjectId;
  videoCategoryId?: mongoose.Types.ObjectId;
  pcMaterialId?: mongoose.Types.ObjectId;
  
  createdAt: Date;
  updatedAt: Date;
}

const courseSchema: Schema = new Schema(
  {
    name: { type: String, required: true },
    description: { type: String, required: true },
    image: { type: String, required: true },
    ordered: { type: Number, required: true },
    shareableLink: { type: String, default: "" },
    withMaterial: { type: String, default: "" },
    withoutMaterial: { type: String, default: "" },
    level: { type: String, required: true },
    status: { type: Boolean, required: true, default: true },
    
    // Relations
    courseEducatorId: { type: Schema.Types.ObjectId, ref: "CourseEducator", default: null },
    courseSubjectCategoryId: { type: Schema.Types.ObjectId, ref: "CourseSubjectCategory", default: null },
    videoCategoryId: { type: Schema.Types.ObjectId, ref: "VideoCategory", default: null },
    pcMaterialId: { type: Schema.Types.ObjectId, ref: "PackageCourseMaterial", default: null },
  },
  {
    timestamps: true,
  }
);

export const Course = mongoose.model<ICourse>("Course", courseSchema, "ws_courses");
