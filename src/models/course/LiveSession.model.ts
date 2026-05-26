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
  // Timetable metadata — drives the "Schedule" tab, which is derived from the
  // course's scheduled sessions. `subject`/`educatorId` describe the class;
  // `scheduledAt`/`endAt` give the time slot.
  // Required when liveCourseIds is non-empty — drives subject-based auto
  // folder grouping when recordings arrive (a folder is auto-resolved/created
  // per liveCourseId using the normalized subject).
  subject?: string;
  educatorId?: Types.ObjectId | null;
  endAt?: Date | null;
  scheduledAt?: Date | null;
  // Streamos stream id — a STRING (e.g. "T_17787583234029"), not a number.
  // It's the canonical id (the part before any "?token" suffix) used for
  // streamDetails / endStream lookups and as the Socket.IO room id.
  streamId?: string | null;
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
    // Timetable metadata. Optional — a session can exist without being part of
    // a published schedule, but the Schedule tab reads these when present.
    subject:     { type: String, default: "", trim: true, maxlength: 300 },
    educatorId:  { type: Schema.Types.ObjectId, ref: "CourseEducator", default: null },
    endAt:       { type: Date, default: null },
    scheduledAt: { type: Date, default: null, index: true },
    // streamId/rtmpUrl/hlsUrl are only populated once the stream actually
    // starts on Streamos. SCHEDULED rows do not have them yet, so the field
    // is optional. Streamos returns it as a STRING. The unique index is
    // declared below via partialFilterExpression (sparse would not help — it
    // treats `null` as present).
    streamId: { type: String, default: null },
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

// Enforce uniqueness only on rows that actually carry a string streamId.
// SCHEDULED sessions before they start have streamId: null and must not
// collide with each other.
LiveSessionSchema.index(
  { streamId: 1 },
  { unique: true, partialFilterExpression: { streamId: { $type: "string" } } }
);

export const LiveSession = model<ILiveSession>("LiveSession", LiveSessionSchema);
