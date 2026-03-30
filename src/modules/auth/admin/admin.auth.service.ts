import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { AdminUser } from "../../../models/admin/AdminUser.model";

const JWT_SECRET = process.env.JWT_ACCESS_SECRET as string;
const JWT_TTL = process.env.JWT_ADMIN_TTL || "24h";
const SALT_ROUNDS = 10;

// ─── Login ────────────────────────────────────────────────────────────────────
export async function adminLogin(
  email: string,
  password: string
): Promise<{ ok: boolean; message: string; token?: string; admin?: Record<string, unknown> }> {
  const admin = await AdminUser.findOne({
    email: email.toLowerCase().trim(),
    status: true,
  }).select("+password");

  if (!admin) {
    return { ok: false, message: "Invalid email or password." };
  }

  const isMatch = await bcrypt.compare(password, admin.password);
  if (!isMatch) {
    return { ok: false, message: "Invalid email or password." };
  }

  const token = jwt.sign(
    { id: admin._id.toString(), email: admin.email, role: admin.role },
    JWT_SECRET,
    { expiresIn: JWT_TTL as any }
  );

  return {
    ok: true,
    message: "Login successful.",
    token,
    admin: {
      id: admin._id,
      firstName: admin.firstName,
      lastName: admin.lastName ?? "",
      email: admin.email,
      role: admin.role,
      image: admin.image ?? "",
      isDark: admin.isDark,
    },
  };
}

// ─── Register (internal / seeder use) ────────────────────────────────────────
export async function createAdminUser(data: {
  firstName: string;
  lastName?: string;
  email: string;
  password: string;
  role?: string;
}): Promise<{ ok: boolean; message: string }> {
  const exists = await AdminUser.findOne({ email: data.email.toLowerCase() });
  if (exists) return { ok: false, message: "Admin with this email already exists." };

  const hashed = await bcrypt.hash(data.password, SALT_ROUNDS);
  await AdminUser.create({ ...data, password: hashed, email: data.email.toLowerCase() });
  return { ok: true, message: "Admin user created successfully." };
}

// ─── Change password ──────────────────────────────────────────────────────────
export async function changeAdminPassword(
  adminId: string,
  currentPassword: string,
  newPassword: string
): Promise<{ ok: boolean; message: string }> {
  const admin = await AdminUser.findById(adminId).select("+password");
  if (!admin) return { ok: false, message: "Admin not found." };

  const isMatch = await bcrypt.compare(currentPassword, admin.password);
  if (!isMatch) return { ok: false, message: "Current password is incorrect." };

  admin.password = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await admin.save();
  return { ok: true, message: "Password updated successfully." };
}
