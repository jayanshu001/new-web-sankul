import { Schema, model, Document } from "mongoose";

export interface IRole extends Document {
  name: string;
  guardName: string;
  permissions: Schema.Types.ObjectId[];
  createdAt?: Date;
  updatedAt?: Date;
}

const RoleSchema = new Schema<IRole>(
  {
    name: { type: String, required: true, maxlength: 255 },
    guardName: { type: String, required: true, maxlength: 255 },
    permissions: [{ type: Schema.Types.ObjectId, ref: "Permission" }],
  },
  { collection: "ws_roles", timestamps: true }
);

RoleSchema.index({ name: 1, guardName: 1 }, { unique: true });

export const Role = model<IRole>("Role", RoleSchema);
