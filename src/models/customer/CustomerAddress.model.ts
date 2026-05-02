import { Schema, model, Document, Types } from "mongoose";

export interface ICustomerAddress extends Document {
  name: string;
  phone?: string;
  alternatePhone?: string;
  email?: string;
  address: string;
  address2: string;
  cityId?: Types.ObjectId;
  stateId?: Types.ObjectId;
  pincode: string;
  label: "home" | "work" | "other";
  isDefault: boolean;
  customerId?: Types.ObjectId;
  status?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const CustomerAddressSchema = new Schema<ICustomerAddress>(
  {
    name: { type: String, required: true, maxlength: 50 },
    phone: { type: String, maxlength: 15 },
    alternatePhone: { type: String, maxlength: 15 },
    email: { type: String, maxlength: 100 },
    address: { type: String, required: true, maxlength: 255 },
    address2: { type: String, maxlength: 255 },
    cityId: { type: Schema.Types.ObjectId, ref: "OfflineCity" },
    stateId: { type: Schema.Types.ObjectId, ref: "CustomerState" },
    pincode: { type: String, required: true, maxlength: 10 },
    label: { type: String, enum: ["home", "work", "other"], default: "home" },
    customerId: { type: Schema.Types.ObjectId, ref: "Customer" },
    status: { type: Boolean, default: true },
    isDefault: { type: Boolean, default: false },
  },
  { collection: "ws_customer_addresses", timestamps: true }
);

CustomerAddressSchema.index({ customerId: 1 });

export const CustomerAddress = model<ICustomerAddress>(
  "CustomerAddress",
  CustomerAddressSchema
);
