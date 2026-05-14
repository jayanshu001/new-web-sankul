import { Schema, model, Document, Types } from "mongoose";

/**
 * A customer's reminder for an upcoming SCHEDULED live session.
 *
 * The reminder itself is just the user's intent + bookkeeping; the actual
 * delivery is handled by a backing scheduled `Notification` row + BullMQ job
 * (see live-reminder.service.ts), so reminders ride the existing notification
 * dispatcher → FCM path. `notificationId` links to that backing row.
 */
export type LiveSessionReminderStatus = "scheduled" | "cancelled";

export interface ILiveSessionReminder extends Document {
  customerId: Types.ObjectId;
  liveSessionId: Types.ObjectId;
  // First course of the session at set-time — snapshot for deep-linking.
  liveCourseId?: Types.ObjectId | null;
  // How many minutes before the session start to fire the reminder.
  minutesBefore: number;
  // The actual fire time = scheduledAt - minutesBefore (clamped to "not past").
  remindAt: Date;
  // Snapshot of the session's scheduledAt when the reminder was set — lets the
  // client detect drift if an admin later reschedules the class.
  sessionScheduledAt: Date;
  // The backing scheduled Notification row that delivers this reminder.
  notificationId?: Types.ObjectId | null;
  status: LiveSessionReminderStatus;
  createdAt: Date;
  updatedAt: Date;
}

const LiveSessionReminderSchema = new Schema<ILiveSessionReminder>(
  {
    customerId:    { type: Schema.Types.ObjectId, ref: "Customer", required: true, index: true },
    liveSessionId: { type: Schema.Types.ObjectId, ref: "LiveSession", required: true, index: true },
    liveCourseId:  { type: Schema.Types.ObjectId, ref: "LiveCourse", default: null },
    minutesBefore: { type: Number, required: true, min: 0 },
    remindAt:      { type: Date, required: true, index: true },
    sessionScheduledAt: { type: Date, required: true },
    notificationId: { type: Schema.Types.ObjectId, ref: "Notification", default: null },
    status: {
      type: String,
      enum: ["scheduled", "cancelled"],
      default: "scheduled",
      index: true,
    },
  },
  { timestamps: true }
);

// One reminder per customer per session — POST /live-reminders upserts on this.
LiveSessionReminderSchema.index({ customerId: 1, liveSessionId: 1 }, { unique: true });

export const LiveSessionReminder = model<ILiveSessionReminder>(
  "LiveSessionReminder",
  LiveSessionReminderSchema
);
