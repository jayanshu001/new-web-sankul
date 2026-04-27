import { Schema, model, Document } from "mongoose";

export interface IPermission extends Document {
  name: string;
  guardName: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const PermissionSchema = new Schema<IPermission>(
  {
    name: { type: String, required: true, maxlength: 255 },
    guardName: { type: String, required: true, maxlength: 255 },
  },
  { collection: "ws_permissions", timestamps: true }
);

PermissionSchema.index({ name: 1, guardName: 1 }, { unique: true });

export const Permission = model<IPermission>("Permission", PermissionSchema);
