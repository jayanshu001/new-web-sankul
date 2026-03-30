import { Schema, model, Document } from "mongoose";

export interface ICustomerState extends Document {
  name: string;
  stateCode: string;
  active: boolean;
}

const CustomerStateSchema = new Schema<ICustomerState>(
  {
    name: { type: String, required: true, maxlength: 255 },
    stateCode: { type: String, required: true, maxlength: 255 },
    active: { type: Boolean, required: true, default: true },
  },
  { collection: "ws_customer_states", timestamps: false }
);

export const CustomerState = model<ICustomerState>("CustomerState", CustomerStateSchema);
