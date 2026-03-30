import { Schema, model, Document } from "mongoose";

export interface IDepartmentContact {
  mobile: string;
  isCallAvailable: boolean;
  isWhatsAppAvailable: boolean;
  order: number;
  active: boolean;
}

export interface IDepartment extends Document {
  name: string;
  description: string;
  order: number;
  active: boolean;
  contacts: IDepartmentContact[];
}

const DepartmentContactSchema = new Schema<IDepartmentContact>(
  {
    mobile: { type: String, required: true, maxlength: 20 },
    isCallAvailable: { type: Boolean, required: true },
    isWhatsAppAvailable: { type: Boolean, required: true },
    order: { type: Number, required: true },
    active: { type: Boolean, required: true },
  },
  { _id: false }
);

const DepartmentSchema = new Schema<IDepartment>(
  {
    name: { type: String, required: true },
    description: { type: String, required: true },
    order: { type: Number, required: true },
    active: { type: Boolean, required: true },
    contacts: { type: [DepartmentContactSchema], default: [] },
  },
  { collection: "ws_departments", timestamps: false }
);

export const Department = model<IDepartment>("Department", DepartmentSchema);
