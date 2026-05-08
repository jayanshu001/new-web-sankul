import { Schema, model, Document, Types } from "mongoose";

/**
 * One row per (customer, video). Tracks where the user paused/resumed
 * inside a single lecture (Video). The course-level "Resume Learning" UI
 * is built on top of this — the most recent row per courseId tells us
 * which lecture to surface as the user's "resume next".
 */
export interface ILectureProgress extends Document {
  customerId: Types.ObjectId;
  videoId: Types.ObjectId;
  courseId: Types.ObjectId; // denormalised for fast per-course rollups
  positionSec: number; // last reported playback position
  durationSec: number; // total length of the lecture, as the player saw it
  completed: boolean; // sticky once true; set when positionSec >= 95% of duration
  completedAt?: Date | null;
  lastWatchedAt: Date; // also drives "Last Watched 2 days ago" + sort order on My Courses
  createdAt?: Date;
  updatedAt?: Date;
}

const LectureProgressSchema = new Schema<ILectureProgress>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    videoId: { type: Schema.Types.ObjectId, ref: "Video", required: true },
    courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true },
    positionSec: { type: Number, required: true, default: 0, min: 0 },
    durationSec: { type: Number, required: true, default: 0, min: 0 },
    completed: { type: Boolean, default: false },
    completedAt: { type: Date, default: null },
    lastWatchedAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: "ws_lecture_progress", timestamps: true }
);

// One row per (customer, video). The heartbeat endpoint relies on this to upsert.
LectureProgressSchema.index({ customerId: 1, videoId: 1 }, { unique: true });
// Fast "what was the user's most recent activity in this course" lookup.
LectureProgressSchema.index({ customerId: 1, courseId: 1, lastWatchedAt: -1 });
// Counting completed lectures per (customer, course) for the % bar.
LectureProgressSchema.index({ customerId: 1, courseId: 1, completed: 1 });

export const LectureProgress = model<ILectureProgress>(
  "LectureProgress",
  LectureProgressSchema
);
