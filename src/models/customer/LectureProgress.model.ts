import { Schema, model, Document, Types } from "mongoose";

/**
 * One row per (customer, lecture). A "lecture" is either a recorded Video
 * (course / live-course recording) or a LiveSession playback. Progress is
 * global per video: the same Video reached through multiple containers
 * (Course A, Course B, Package X) shares a single row, so watched/completed
 * state is consistent everywhere the video appears.
 *
 * The denormalised parent pointers (courseId / liveCourseId / packageId) are
 * stamped at write time to power the "Resume Learning" / dashboard rollups —
 * any container the user could reach this lecture under is recorded on the
 * single row. They are *not* part of the uniqueness key.
 */
export interface ILectureProgress extends Document {
  customerId: Types.ObjectId;

  // Exactly one of videoId / liveSessionId is set.
  videoId?: Types.ObjectId | null;
  liveSessionId?: Types.ObjectId | null;

  // Denormalised parent pointers for rollups. Any subset may be set on a
  // single row when the lecture is reachable through multiple containers.
  courseId?: Types.ObjectId | null;
  liveCourseId?: Types.ObjectId | null;
  packageId?: Types.ObjectId | null;

  // Set to "free" for a standalone free video watched on its own (the
  // /free-videos catalog), which has NO container pointer. Lets the free
  // "Resume Learning" feed find these rows without a courseId/packageId/
  // liveCourseId to group on. Container-scoped rows leave this null.
  source?: "free" | null;

  positionSec: number;
  durationSec: number;
  completed: boolean; // sticky once true; set when positionSec >= 95% of duration
  completedAt?: Date | null;
  lastWatchedAt: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

const LectureProgressSchema = new Schema<ILectureProgress>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },

    videoId:       { type: Schema.Types.ObjectId, ref: "Video",       default: null },
    liveSessionId: { type: Schema.Types.ObjectId, ref: "LiveSession", default: null },

    courseId:     { type: Schema.Types.ObjectId, ref: "Course",     default: null },
    liveCourseId: { type: Schema.Types.ObjectId, ref: "LiveCourse", default: null },
    packageId:    { type: Schema.Types.ObjectId, ref: "Package",    default: null },

    source: { type: String, enum: ["free", null], default: null },

    positionSec:   { type: Number,  required: true, default: 0, min: 0 },
    durationSec:   { type: Number,  required: true, default: 0, min: 0 },
    completed:     { type: Boolean, default: false },
    completedAt:   { type: Date,    default: null },
    lastWatchedAt: { type: Date,    required: true, default: () => new Date() },
  },
  { collection: "ws_lecture_progress", timestamps: true }
);

// Progress is global per (customer, lecture) — one row regardless of which
// container the user reached the lecture through.
LectureProgressSchema.index(
  { customerId: 1, videoId: 1 },
  {
    unique: true,
    partialFilterExpression: { videoId: { $type: "objectId" } },
    name: "uniq_customer_video",
  }
);
LectureProgressSchema.index(
  { customerId: 1, liveSessionId: 1 },
  {
    unique: true,
    partialFilterExpression: { liveSessionId: { $type: "objectId" } },
    name: "uniq_customer_liveSession",
  }
);

// Fast "most recent activity in this course / live course / package" lookups.
LectureProgressSchema.index({ customerId: 1, courseId: 1, lastWatchedAt: -1 });
LectureProgressSchema.index({ customerId: 1, liveCourseId: 1, lastWatchedAt: -1 });
LectureProgressSchema.index({ customerId: 1, packageId: 1, lastWatchedAt: -1 });

// Fast "most recent free video" lookups for the free Resume Learning feed.
LectureProgressSchema.index({ customerId: 1, source: 1, lastWatchedAt: -1 });

// Completed-lecture counters for the % bar.
LectureProgressSchema.index({ customerId: 1, courseId: 1, completed: 1 });
LectureProgressSchema.index({ customerId: 1, liveCourseId: 1, completed: 1 });
LectureProgressSchema.index({ customerId: 1, packageId: 1, completed: 1 });

export const LectureProgress = model<ILectureProgress>(
  "LectureProgress",
  LectureProgressSchema
);
