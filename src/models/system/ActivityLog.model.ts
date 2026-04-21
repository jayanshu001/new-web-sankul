import { Schema, model, Document, Types } from "mongoose";

export interface IActivityLog extends Document {
  customerId?: Types.ObjectId | null;
  event: string;
  entityType?: string | null;
  entityId?: Types.ObjectId | null;
  duration?: number | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const ActivityLogSchema = new Schema<IActivityLog>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", default: null, index: true },
    event: { type: String, required: true, maxlength: 100 },
    entityType: { type: String, default: null, maxlength: 50 },
    entityId: { type: Schema.Types.ObjectId, default: null },
    duration: { type: Number, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
    ip: { type: String, default: null, maxlength: 100 },
    userAgent: { type: String, default: null, maxlength: 500 },
  },
  { collection: "ws_activity_log", timestamps: true }
);

ActivityLogSchema.index({ event: 1, createdAt: -1 });
ActivityLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
ActivityLogSchema.index({ customerId: 1, createdAt: -1 });

export const ActivityLog = model<IActivityLog>("ActivityLog", ActivityLogSchema);
