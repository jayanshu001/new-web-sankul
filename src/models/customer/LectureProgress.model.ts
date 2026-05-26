import { Schema, model, Document, Types } from "mongoose";

/**
 * One row per (customer, lecture, scope). A "lecture" is either a recorded
 * Video (course / live-course recording) or a LiveSession playback. A
 * "scope" is the container the user is currently inside (course / live
 * course / package) — the same video reached through two different
 * containers gets two independent rows, so position and completion don't
 * bleed between them.
 *
 * The "Resume Learning" UI is built on top of this:
 *   - Course cards: rows with scopeKind="course" filtered by courseId.
 *   - Live Course cards: rows with scopeKind="liveCourse" filtered by
 *     liveCourseId. The lecture may be a Video (folder recording) or a
 *     LiveSession (raw recording playback).
 *   - Package cards: rows with scopeKind="package" filtered by packageId.
 *
 * Legacy rows (written before the scope split) may have null `scopeKind`
 * with one or more of courseId/liveCourseId/packageId set — a one-time
 * backfill fans those out into per-scope rows and deletes the originals.
 */
export interface ILectureProgress extends Document {
  customerId: Types.ObjectId;

  // Exactly one of videoId / liveSessionId is set.
  videoId?: Types.ObjectId | null;
  liveSessionId?: Types.ObjectId | null;

  // Denormalised parent pointers. At least one of courseId / liveCourseId is
  // set so the row can be rolled up onto a "My Courses" / "My Live Courses"
  // card. packageId is set additionally when the watch happened under a
  // package entitlement (a single course can be reached via both a direct
  // course sub and a package sub — both pointers are stored so the same row
  // can power both cards).
  courseId?: Types.ObjectId | null;
  liveCourseId?: Types.ObjectId | null;
  packageId?: Types.ObjectId | null;

  // Which container the user was inside when this row was written. Exactly
  // one of courseId / liveCourseId / packageId is set, matching scopeKind.
  // Null on legacy rows that predate the per-scope split.
  scopeKind?: "course" | "liveCourse" | "package" | null;

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

    scopeKind: {
      type: String,
      enum: ["course", "liveCourse", "package", null],
      default: null,
    },

    positionSec:   { type: Number,  required: true, default: 0, min: 0 },
    durationSec:   { type: Number,  required: true, default: 0, min: 0 },
    completed:     { type: Boolean, default: false },
    completedAt:   { type: Date,    default: null },
    lastWatchedAt: { type: Date,    required: true, default: () => new Date() },
  },
  { collection: "ws_lecture_progress", timestamps: true }
);

// One row per (customer, video, scope). Three partial unique indexes — one
// per scopeKind — so the heartbeat upsert key includes the active container.
// The same video watched under a course and a package now yields two rows.
LectureProgressSchema.index(
  { customerId: 1, videoId: 1, courseId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      videoId: { $type: "objectId" },
      scopeKind: "course",
    },
    name: "uniq_customer_video_course",
  }
);
LectureProgressSchema.index(
  { customerId: 1, videoId: 1, liveCourseId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      videoId: { $type: "objectId" },
      scopeKind: "liveCourse",
    },
    name: "uniq_customer_video_liveCourse",
  }
);
LectureProgressSchema.index(
  { customerId: 1, videoId: 1, packageId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      videoId: { $type: "objectId" },
      scopeKind: "package",
    },
    name: "uniq_customer_video_package",
  }
);

// Same per-scope split for live-session rows.
LectureProgressSchema.index(
  { customerId: 1, liveSessionId: 1, liveCourseId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      liveSessionId: { $type: "objectId" },
      scopeKind: "liveCourse",
    },
    name: "uniq_customer_liveSession_liveCourse",
  }
);
LectureProgressSchema.index(
  { customerId: 1, liveSessionId: 1, packageId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      liveSessionId: { $type: "objectId" },
      scopeKind: "package",
    },
    name: "uniq_customer_liveSession_package",
  }
);

// Legacy (scopeKind=null) rows — keep a partial unique index so the old
// (customer, video) and (customer, liveSession) invariant still holds on
// pre-backfill rows. Drops itself naturally once the backfill removes them.
LectureProgressSchema.index(
  { customerId: 1, videoId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      videoId: { $type: "objectId" },
      scopeKind: null,
    },
    name: "uniq_customer_video_legacy",
  }
);
LectureProgressSchema.index(
  { customerId: 1, liveSessionId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      liveSessionId: { $type: "objectId" },
      scopeKind: null,
    },
    name: "uniq_customer_liveSession_legacy",
  }
);

// Fast "most recent activity in this course / live course / package" lookups.
LectureProgressSchema.index({ customerId: 1, courseId: 1, lastWatchedAt: -1 });
LectureProgressSchema.index({ customerId: 1, liveCourseId: 1, lastWatchedAt: -1 });
LectureProgressSchema.index({ customerId: 1, packageId: 1, lastWatchedAt: -1 });

// Completed-lecture counters for the % bar.
LectureProgressSchema.index({ customerId: 1, courseId: 1, completed: 1 });
LectureProgressSchema.index({ customerId: 1, liveCourseId: 1, completed: 1 });
LectureProgressSchema.index({ customerId: 1, packageId: 1, completed: 1 });

export const LectureProgress = model<ILectureProgress>(
  "LectureProgress",
  LectureProgressSchema
);
