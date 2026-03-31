
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
    email: { type: String, required: true, unique: true, maxlength: 255, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    image: { type: String },
    role: {
      type: String,
      enum: Object.values(AdminRole),
      default: AdminRole.ADMIN,
    },
    status: { type: Boolean, required: true, default: true },
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

export const AdminUser = model<IAdminUser>("AdminUser", AdminUserSchema);
