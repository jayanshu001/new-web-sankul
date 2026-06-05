
import { Schema, model, Document } from "mongoose";
import { AdminRole } from "../enums";

export interface IAdminUser extends Document {
  firstName: string;
  lastName?: string;
  email: string;
  password: string;
  image?: string;
  role: AdminRole;
  status: boolean;
  deleted: boolean;
  isDark: boolean;
  emailVerifiedAt?: Date;
  rememberToken?: string;
  lastLoginDate?: Date;
  lastLoginIp?: string;
  lastSeenAt?: Date;
  roles: Schema.Types.ObjectId[];
  permissions: Schema.Types.ObjectId[];
  createdAt?: Date;
  updatedAt?: Date;
}

const AdminUserSchema = new Schema<IAdminUser>(
  {
    firstName: { type: String, required: true, maxlength: 100 },
    lastName: { type: String, maxlength: 100 },
    // Uniqueness is enforced by a PARTIAL index below (only among non-deleted
    // admins), so a soft-deleted admin frees its email for re-registration.
    email: { type: String, required: true, maxlength: 255, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    image: { type: String },
    role: {
      type: String,
      enum: Object.values(AdminRole),
      default: AdminRole.ADMIN,
    },
    status: { type: Boolean, required: true, default: true },
    // Soft-delete marker. Deleted admins are excluded from login, the admin
    // list/detail, and email-uniqueness checks, but the row is retained so
    // audit logs and historical references still resolve.
    deleted: { type: Boolean, default: false },
    isDark: { type: Boolean, default: false },
    emailVerifiedAt: { type: Date },
    rememberToken: { type: String, select: false },
    lastLoginDate: { type: Date },
    lastLoginIp: { type: String, maxlength: 255 },
    lastSeenAt: { type: Date },
    roles: [{ type: Schema.Types.ObjectId, ref: "Role" }],
    permissions: [{ type: Schema.Types.ObjectId, ref: "Permission" }],
  },
  { collection: "ws_users", timestamps: true }
);

AdminUserSchema.index({ status: 1 });
// Email is unique only among non-deleted admins — a soft-deleted admin's email
// can be reused. Requires the legacy plain-unique index to be dropped (see the
// 2026-soft-delete-admin-educator migration).
AdminUserSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { deleted: false } }
);

export const AdminUser = model<IAdminUser>("AdminUser", AdminUserSchema);
