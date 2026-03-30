import { Schema, model, Document, Types } from "mongoose";

export interface ICustomerDistrict extends Document {
  name: string;
  stateId: Types.ObjectId;
  active: boolean;
}

const CustomerDistrictSchema = new Schema<ICustomerDistrict>(
  {
    name: { type: String, required: true, maxlength: 255 },
    stateId: { type: Schema.Types.ObjectId, ref: "CustomerState", required: true },
    active: { type: Boolean, required: true, default: true },
  },
  { collection: "ws_customer_districts", timestamps: false }
);

CustomerDistrictSchema.index({ stateId: 1 });

export const CustomerDistrict = model<ICustomerDistrict>(
  "CustomerDistrict",
  CustomerDistrictSchema
);
