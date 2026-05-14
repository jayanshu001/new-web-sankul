import mongoose, { Schema, Document } from "mongoose";

/**
 * One row per customer join → leave on a live class. A customer who joins,
 * leaves, and rejoins produces multiple rows (each a viewing stint), which is
 * what you want for accurate watch-time analytics.
 *
 * Written by the Socket.IO layer: a row is opened on `join_live_chat` and
 * closed (leftAt + durationSec) on `leave_live_chat` / `disconnect`, or in
 * bulk when the stream is ended.
 */
export interface ILiveSessionAttendance extends Document {
  streamId: string;                                 // the live class id (Streamos streamId)
  liveSessionId?: mongoose.Types.ObjectId | null;   // resolved LiveSession._id, when known
  customerId: mongoose.Types.ObjectId;
  userName: string;
  joinedAt: Date;
  leftAt?: Date | null;                             // null while the viewer is still connected
  durationSec?: number | null;                      // set when the row is closed
  createdAt: Date;
  updatedAt: Date;
}

const liveSessionAttendanceSchema: Schema = new Schema(
  {
    streamId:      { type: String, required: true, index: true },
    liveSessionId: { type: Schema.Types.ObjectId, ref: "LiveSession", default: null, index: true },
    customerId:    { type: Schema.Types.ObjectId, ref: "Customer", required: true, index: true },
    userName:      { type: String, default: "" },
    joinedAt:      { type: Date, required: true },
    leftAt:        { type: Date, default: null },
    durationSec:   { type: Number, default: null },
  },
  { timestamps: true, collection: "ws_live_session_attendance" }
);

// Listing a class's attendance, newest stint first.
liveSessionAttendanceSchema.index({ streamId: 1, joinedAt: -1 });
// Fast "still in the room" lookups (the Socket.IO layer closes these).
liveSessionAttendanceSchema.index({ streamId: 1, leftAt: 1 });

export const LiveSessionAttendance = mongoose.model<ILiveSessionAttendance>(
  "LiveSessionAttendance",
  liveSessionAttendanceSchema
);
