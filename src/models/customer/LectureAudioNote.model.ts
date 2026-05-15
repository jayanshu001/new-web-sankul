import { Schema, model, Document, Types } from "mongoose";

export type LectureAudioNoteType = "recorded" | "live";

/**
 * Customer-recorded audio clip pinned to a moment inside a lecture. Mirrors
 * LectureNote one-for-one — same subscriber-only gate, same per-lecture list,
 * same multiple-rows-per-lecture semantics — but stores an S3-hosted audio
 * file instead of text.
 *
 * `audioKey` is the bucket-relative key we need to issue a DeleteObject when
 * the row is deleted (the public `audioUrl` is what the client plays).
 */
export interface ILectureAudioNote extends Document {
  customerId: Types.ObjectId;
  lectureType: LectureAudioNoteType;
  videoId?: Types.ObjectId | null;
  liveSessionId?: Types.ObjectId | null;
  courseId?: Types.ObjectId | null;
  liveCourseIds?: Types.ObjectId[];
  timestampSec: number;
  title?: string;
  audioUrl: string;
  audioKey: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  durationSec?: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const LectureAudioNoteSchema = new Schema<ILectureAudioNote>(
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
    title:         { type: String, default: "", trim: true, maxlength: 200 },
    audioUrl:      { type: String, required: true, maxlength: 1000 },
    audioKey:      { type: String, required: true, maxlength: 1000 },
    mimeType:      { type: String, default: null, maxlength: 100 },
    sizeBytes:     { type: Number, default: null, min: 0 },
    // Optional — clients that know the recording's duration up front can post
    // it; otherwise null and the player can probe it.
    durationSec:   { type: Number, default: null, min: 0 },
  },
  { collection: "ws_lecture_audio_notes", timestamps: true }
);

LectureAudioNoteSchema.index({ customerId: 1, videoId: 1, timestampSec: 1 });
LectureAudioNoteSchema.index({ customerId: 1, liveSessionId: 1, timestampSec: 1 });

export const LectureAudioNote = model<ILectureAudioNote>(
  "LectureAudioNote",
  LectureAudioNoteSchema
);
