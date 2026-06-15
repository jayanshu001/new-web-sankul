import { Schema, model, Document, Types } from "mongoose";

export interface IOfflineCity extends Document {
  name: string;
  image: string;
  // The state this city belongs to. Optional during the migration window so
  // existing cities (created before this field) still read; new/edited cities
  // should set it so the client can fetch cities by state.
  stateId?: Types.ObjectId | null;
  order: number;
  status: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const OfflineCitySchema = new Schema<IOfflineCity>(
  {
    name: { type: String, required: true, maxlength: 100 },
    image: { type: String, required: true, maxlength: 500 },
    stateId: { type: Schema.Types.ObjectId, ref: "CustomerState", default: null },
    order: { type: Number, default: 0 },
    status: { type: Boolean, default: true },
  },
  { collection: "ws_offline_city", timestamps: true }
);

OfflineCitySchema.index({ status: 1, order: 1 });
// Fast "cities in this state" lookups for the client dropdown.
OfflineCitySchema.index({ stateId: 1, status: 1, order: 1 });

export const OfflineCity = model<IOfflineCity>("OfflineCity", OfflineCitySchema);
