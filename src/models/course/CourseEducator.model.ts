import mongoose, { Schema, Document } from "mongoose";

export interface ICourseEducator extends Document {
  name: string;
  image: string;
  about: string;
  email: string;
  password?: string; // Optional if not all educators have login
  view: number;
  status: boolean;
  deleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const courseEducatorSchema: Schema = new Schema(
  {
    name: { type: String, required: true },
    image: { type: String, required: true },
    about: { type: String, default: "" },
    // Uniqueness enforced by a PARTIAL index below (non-deleted only), so a
    // soft-deleted educator's email can be reused.
    email: { type: String, required: true },
    password: { type: String, default: null },
    view: { type: Number, default: 0 },
    status: { type: Boolean, default: true },
    // Soft-delete marker. Deleted educators are hidden from the educator
    // list/detail and email-uniqueness checks, but the row is retained so
    // existing course/live-course `courseEducatorId` references still resolve.
    deleted: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  }
);

// Email unique only among non-deleted educators. Requires the legacy plain-
// unique index to be dropped (see 2026-soft-delete-admin-educator migration).
courseEducatorSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { deleted: false } }
);

export const CourseEducator = mongoose.model<ICourseEducator>("CourseEducator", courseEducatorSchema, "ws_course_educators");
