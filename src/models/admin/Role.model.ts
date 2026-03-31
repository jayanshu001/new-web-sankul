import { Schema, model, Document } from "mongoose";

export interface IRole extends Document {
  name: string;
  guardName: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const RoleSchema = new Schema<IRole>(
  {
    name: { type: String, required: true, maxlength: 255 },
    guardName: { type: String, required: true, maxlength: 255 },
  },
  { collection: "ws_roles", timestamps: true }
);

export const Role = model<IRole>("Role", RoleSchema);
