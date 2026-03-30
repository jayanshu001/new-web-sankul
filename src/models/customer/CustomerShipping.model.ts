import { Schema, model, Document, Types } from "mongoose";

export interface ICustomerShipping extends Document {
  name: string;
  phone: string;
  alternatePhone?: string;
  email: string;
  address: string;
  address2: string;
  city: string;
  stateId?: Types.ObjectId;
  pincode: string;
  customerId?: Types.ObjectId;
  status?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const CustomerShippingSchema = new Schema<ICustomerShipping>(
  {
    name: { type: String, required: true, maxlength: 50 },
    phone: { type: String, required: true, maxlength: 15 },
    alternatePhone: { type: String, maxlength: 15 },
    email: { type: String, required: true, maxlength: 100 },
    address: { type: String, required: true, maxlength: 255 },
    address2: { type: String, maxlength: 255 },
    city: { type: String, required: true, maxlength: 20 },
    stateId: { type: Schema.Types.ObjectId, ref: "CustomerState" },
    pincode: { type: String, required: true, maxlength: 10 },
    customerId: { type: Schema.Types.ObjectId, ref: "Customer" },
    status: { type: Boolean, default: true },
  },
  { collection: "ws_customer_shippings", timestamps: true }
);

CustomerShippingSchema.index({ customerId: 1 });

export const CustomerShipping = model<ICustomerShipping>(
  "CustomerShipping",
  CustomerShippingSchema
);
