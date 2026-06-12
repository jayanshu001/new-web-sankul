import mongoose, { Schema, Document } from "mongoose";

export interface ILiveCoursePlan extends Document {
  liveCourseId: mongoose.Types.ObjectId;
  name?: string | null;
  duration: number; // DAYS (validity window length); endAt = startAt + duration days
  price: number;          // the amount actually charged
  originalPrice?: number; // MRP / pre-discount price, for the strikethrough UI
  isDefault: boolean;
  status: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const liveCoursePlanSchema: Schema = new Schema(
  {
    liveCourseId: { type: Schema.Types.ObjectId, ref: "LiveCourse", required: true, index: true },
    name:          { type: String, default: null },
    duration:      { type: Number, required: true, min: 1 }, // DAYS — see interface note
    price:         { type: Number, required: true, min: 0 },
    // MRP shown struck-through next to `price`. Optional; when unset or <= price
    // the UI simply shows no discount.
    originalPrice: { type: Number, default: null, min: 0 },
    isDefault:     { type: Boolean, default: false },
    status:       { type: Boolean, default: true },
  },
  { timestamps: true, collection: "ws_live_course_plans" }
);

liveCoursePlanSchema.index({ liveCourseId: 1, status: 1 });

export const LiveCoursePlan = mongoose.model<ILiveCoursePlan>("LiveCoursePlan", liveCoursePlanSchema);
