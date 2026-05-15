import { Schema, model, Document, Types } from "mongoose";

export type LectureNoteType = "recorded" | "live";

/**
 * Per-subscriber note pinned to a moment inside a lecture. Used for both
 * recorded lectures (Video) and live sessions (LiveSession). Exactly one of
 * videoId / liveSessionId is set, matching `lectureType`.
 *
 * `timestampSec` is the player position the note was taken at, so the client
 * can render the notes timeline alongside the scrubber and jump back to that
 * moment on tap.
 */
export interface ILectureNote extends Document {
  customerId: Types.ObjectId;
  lectureType: LectureNoteType;
  videoId?: Types.ObjectId | null;
  liveSessionId?: Types.ObjectId | null;
  // Denormalised so we can authorise reads/writes without re-resolving the
  // lecture each time. `courseId` for recorded lectures, `liveCourseIds` for
  // live sessions (a session can belong to several cohorts).
  courseId?: Types.ObjectId | null;
  liveCourseIds?: Types.ObjectId[];
  timestampSec: number;
  content: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const LectureNoteSchema = new Schema<ILectureNote>(
  {
    customerId:    { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    lectureType:   { type: String, enum: ["recorded", "live"], required: true },
    videoId:       { type: Schema.Types.ObjectId, ref: "Video", default: null },
    liveSessionId: { type: Schema.Types.ObjectId, ref: "LiveSession", default: null },
    courseId:      { type: Schema.Types.ObjectId, ref: "Course", default: null },
    liveCourseIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "LiveCourse" }],
      default: [],
    },
    timestampSec:  { type: Number, required: true, min: 0, default: 0 },
    content:       { type: String, required: true, trim: true, maxlength: 5000 },
  },
  { collection: "ws_lecture_notes", timestamps: true }
);

// Primary read pattern: load all notes a customer wrote for a given lecture,
// sorted by their timestamp inside that lecture.
LectureNoteSchema.index({ customerId: 1, videoId: 1, timestampSec: 1 });
LectureNoteSchema.index({ customerId: 1, liveSessionId: 1, timestampSec: 1 });

export const LectureNote = model<ILectureNote>("LectureNote", LectureNoteSchema);
