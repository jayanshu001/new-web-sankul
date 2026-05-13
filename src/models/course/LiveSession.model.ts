import { Schema, model, Document, Types } from "mongoose";

export type LiveSessionStatus = "SCHEDULED" | "CREATED" | "ENDED" | "READY";

export interface ILiveSessionRecording {
  quality?: string;
  file_size?: number;
  path: string;
}

export interface ILiveSession extends Document {
  title: string;
  liveCourseIds: Types.ObjectId[];
  // If set at schedule time, the recording webhook will auto-create a Video
  // in this folder once Streamos delivers recordings. Otherwise the recording
  // only lives on this session and admin must promote it manually.
  recordingTargetFolderId?: Types.ObjectId | null;
  scheduledAt?: Date | null;
  streamId?: number | null;
  rtmpUrl?: string | null;
  hlsUrl?: string | null;
  hlsUrls?: Record<string, string> | null;
  status: LiveSessionStatus;
  recordings: ILiveSessionRecording[];
  createdAt: Date;
  updatedAt: Date;
}

const RecordingSchema = new Schema<ILiveSessionRecording>(
  {
    quality:   { type: String },
    file_size: { type: Number },
    path:      { type: String, required: true },
  },
  { _id: false }
);

const LiveSessionSchema = new Schema<ILiveSession>(
  {
    title:       { type: String, required: true, maxlength: 500 },
    // A session may belong to multiple live courses simultaneously (e.g. one
    // batch streams to several cohorts at the same time).
    liveCourseIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "LiveCourse" }],
      default: [],
      index: true,
    },
    recordingTargetFolderId: {
      type: Schema.Types.ObjectId,
      ref: "VideoCategory",
      default: null,
    },
    scheduledAt: { type: Date, default: null, index: true },
    // streamId/rtmpUrl/hlsUrl are only populated once the stream actually
    // starts on Streamos. SCHEDULED rows do not have them yet, so the field
    // is optional. The unique index is declared below via partialFilterExpression
    // (sparse would not help — it treats `null` as present).
    streamId: { type: Number, default: null },
    rtmpUrl:  { type: String, default: null },
    hlsUrl:   { type: String, default: null },
    // Per-quality HLS URLs ({ "240": "...", "360": "...", "480": "...", "720": "..." }).
    hlsUrls:  { type: Schema.Types.Mixed, default: null },
    status: {
      type: String,
      enum: ["SCHEDULED", "CREATED", "ENDED", "READY"],
      default: "CREATED",
      index: true,
    },
    recordings: { type: [RecordingSchema], default: [] },
  },
  { collection: "ws_live_sessions", timestamps: true }
);

// Enforce uniqueness only on rows that actually carry a numeric streamId.
// SCHEDULED sessions before they start have streamId: null and must not
// collide with each other.
LiveSessionSchema.index(
  { streamId: 1 },
  { unique: true, partialFilterExpression: { streamId: { $type: "number" } } }
);

export const LiveSession = model<ILiveSession>("LiveSession", LiveSessionSchema);
