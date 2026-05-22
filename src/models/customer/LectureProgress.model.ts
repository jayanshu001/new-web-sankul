import { Schema, model, Document, Types } from "mongoose";

/**
 * One row per (customer, lecture). A "lecture" is either a recorded Video
 * (course / live-course recording) or a LiveSession recording playback.
 *
 * The "Resume Learning" UI on the client is built on top of this:
 *   - For Course / Package cards: the most recent row whose courseId matches
 *     drives the resume target.
 *   - For Live Course cards: the most recent row whose liveCourseId matches
 *     drives the resume target. The lecture may be a Video (folder recording)
 *     or a LiveSession (raw recording playback) — videoId / liveSessionId are
 *     mutually exclusive on a given row.
 *
 * `packageId` is denormalised on rows watched under a package subscription so
 * we can roll up % completion at the package level without re-joining through
 * PackageVideoCategoryRelation on every read.
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

    positionSec:   { type: Number,  required: true, default: 0, min: 0 },
    durationSec:   { type: Number,  required: true, default: 0, min: 0 },
    completed:     { type: Boolean, default: false },
    completedAt:   { type: Date,    default: null },
    lastWatchedAt: { type: Date,    required: true, default: () => new Date() },
  },
  { collection: "ws_lecture_progress", timestamps: true }
);

// One row per (customer, video) — heartbeat upserts on this.
// Partial filter: only enforce uniqueness on rows that actually carry a
// videoId, otherwise every (customer, null) live-session row would collide.
LectureProgressSchema.index(
  { customerId: 1, videoId: 1 },
  { unique: true, partialFilterExpression: { videoId: { $type: "objectId" } } }
);
// Same idea for live-session rows.
LectureProgressSchema.index(
  { customerId: 1, liveSessionId: 1 },
  { unique: true, partialFilterExpression: { liveSessionId: { $type: "objectId" } } }
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
