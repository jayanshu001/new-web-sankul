import mongoose, { Schema, Document } from "mongoose";

export interface IGoalLabel extends Document {
  name: string;
}

export interface IGoal extends Document {
  title: string;        // e.g., "Civil Services Exams"
  labels: IGoalLabel[]; // Array of unique objects [{ _id, name }]
  image?: string;       // S3 URL for the category icon
  isActive: boolean;    // dictates visibility on the mobile app
  createdAt: Date;
  updatedAt: Date;
}

const goalLabelSchema = new Schema({
  name: { type: String, required: true },
});

const goalSchema: Schema = new Schema(
  {
    title: { type: String, required: true },
    labels: { type: [goalLabelSchema], default: [] },
    image: { type: String, default: null },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true, // auto creates createdAt and updatedAt
  }
);

export const Goal = mongoose.model<IGoal>("Goal", goalSchema, "ws_goals");
