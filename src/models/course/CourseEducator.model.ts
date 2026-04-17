import mongoose, { Schema, Document } from "mongoose";

export interface ICourseEducator extends Document {
  name: string;
  image: string;
  about: string;
  email: string;
  password?: string; // Optional if not all educators have login
  view: number;
  status: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const courseEducatorSchema: Schema = new Schema(
  {
    name: { type: String, required: true },
    image: { type: String, required: true },
    about: { type: String, default: "" },
    email: { type: String, required: true, unique: true },
    password: { type: String, default: null },
    view: { type: Number, default: 0 },
    status: { type: Boolean, default: true },
  },
  {
    timestamps: true,
  }
);

export const CourseEducator = mongoose.model<ICourseEducator>("CourseEducator", courseEducatorSchema, "ws_course_educators");
