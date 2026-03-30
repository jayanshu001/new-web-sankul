import { Schema, model, Document } from "mongoose";

export interface ICustomerEducation extends Document {
  name: string;
  status: boolean;
}

const CustomerEducationSchema = new Schema<ICustomerEducation>(
  {
    name: { type: String, required: true, maxlength: 255 },
    status: { type: Boolean, required: true, default: true },
  },
  { collection: "ws_customer_educations", timestamps: false }
);

export const CustomerEducation = model<ICustomerEducation>(
  "CustomerEducation",
  CustomerEducationSchema
);
