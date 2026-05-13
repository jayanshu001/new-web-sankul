import mongoose, { Schema, Document } from "mongoose";

export interface ILiveCoursePlan extends Document {
  liveCourseId: mongoose.Types.ObjectId;
  name?: string | null;
  duration: number; // months
  price: number;
  isDefault: boolean;
  status: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const liveCoursePlanSchema: Schema = new Schema(
  {
    liveCourseId: { type: Schema.Types.ObjectId, ref: "LiveCourse", required: true, index: true },
    name:         { type: String, default: null },
    duration:     { type: Number, required: true, min: 1 },
    price:        { type: Number, required: true, min: 0 },
    isDefault:    { type: Boolean, default: false },
    status:       { type: Boolean, default: true },
  },
  { timestamps: true, collection: "ws_live_course_plans" }
);

liveCoursePlanSchema.index({ liveCourseId: 1, status: 1 });

export const LiveCoursePlan = mongoose.model<ILiveCoursePlan>("LiveCoursePlan", liveCoursePlanSchema);
