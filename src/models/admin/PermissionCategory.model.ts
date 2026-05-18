import { Schema, model, Document } from "mongoose";

export interface IPermissionCategory extends Document {
  title: string;
  slug: string;
  order: number;
  status: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const PermissionCategorySchema = new Schema<IPermissionCategory>(
  {
    title: { type: String, required: true, maxlength: 255 },
    slug: { type: String, required: true, unique: true, maxlength: 255 },
    order: { type: Number, default: 0 },
    status: { type: Boolean, default: true },
  },
  { collection: "ws_permission_categories", timestamps: true }
);

PermissionCategorySchema.index({ status: 1, order: 1 });

export const PermissionCategory = model<IPermissionCategory>(
  "PermissionCategory",
  PermissionCategorySchema
);
