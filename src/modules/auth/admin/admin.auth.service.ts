import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { AdminUser } from "../../../models/admin/AdminUser.model";
import { AdminAccessToken } from "../../../models/admin/AdminAccessToken.model";
import { redisClient } from "../../../config/redis";
import { deleteFromS3FileUrl } from "../../../middlewares/upload";

const JWT_SECRET = process.env.JWT_ACCESS_SECRET as string;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET as string;
const JWT_ACCESS_TTL_DAYS = 1;
const JWT_REFRESH_TTL_DAYS = 30;
const SALT_ROUNDS = 10;

function addDays(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

// ─── Login ────────────────────────────────────────────────────────────────────
export async function adminLogin(
  email: string,
  password: string,
  ip?: string
): Promise<{ ok: boolean; message: string; token?: string; refreshToken?: string; admin?: Record<string, unknown> }> {
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

  // Invalidate old tokens (Optional strict 1-device admin rule)
  await AdminAccessToken.updateMany(
    { adminUserId: admin._id },
    { active: false, deleted: true }
  );

  // Track login stats
  admin.lastLoginIp = ip || admin.lastLoginIp;
  admin.lastLoginDate = new Date();
  await admin.save();

  const token = jwt.sign(
    { id: admin._id.toString(), email: admin.email, role: admin.role, type: "admin" },
    JWT_SECRET,
    { expiresIn: `${JWT_ACCESS_TTL_DAYS}d` }
  );

  const refreshToken = jwt.sign(
    { id: admin._id.toString(), email: admin.email, role: admin.role, type: "admin" },
    JWT_REFRESH_SECRET,
    { expiresIn: `${JWT_REFRESH_TTL_DAYS}d` }
  );

  const expiresAt = addDays(JWT_REFRESH_TTL_DAYS);
  await AdminAccessToken.create({
    adminUserId: admin._id,
    token,
    refreshToken,
    active: true,
    deleted: false,
    expiresAt,
  });

  await redisClient.set(
    `admin_session:${admin._id.toString()}`,
    token,
    "EX",
    JWT_ACCESS_TTL_DAYS * 24 * 60 * 60
  );

  return {
    ok: true,
    message: "Login successful.",
    token,
    refreshToken,
    admin: {
      id: admin._id,
      firstName: admin.firstName,
      lastName: admin.lastName ?? "",
      email: admin.email,
      role: admin.role,
      roles: admin.roles ?? [],
      permissions: admin.permissions ?? [],
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

// ─── Validation & Refresh ─────────────────────────────────────────────────────
export async function refreshAdminToken(refreshToken: string) {
  if (!refreshToken) {
    return { ok: false, message: "Refresh token is required." };
  }

  try {
    const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET) as any;
    const adminUserId = decoded.id;

    const dbToken = await AdminAccessToken.findOne({
      refreshToken,
      adminUserId,
      active: true,
      deleted: false,
    });

    if (!dbToken) {
      return { ok: false, message: "Invalid or revoked refresh token." };
    }

    const admin = await AdminUser.findOne({ _id: adminUserId, status: true });
    if (!admin) {
      return { ok: false, message: "Admin not found or disabled." };
    }

    await AdminAccessToken.updateOne({ _id: dbToken._id }, { active: false, deleted: true });

    const newToken = jwt.sign(
      { id: admin._id.toString(), email: admin.email, role: admin.role, type: "admin" },
      JWT_SECRET,
      { expiresIn: `${JWT_ACCESS_TTL_DAYS}d` }
    );

    const newRefreshToken = jwt.sign(
      { id: admin._id.toString(), email: admin.email, role: admin.role, type: "admin" },
      JWT_REFRESH_SECRET,
      { expiresIn: `${JWT_REFRESH_TTL_DAYS}d` }
    );

    const expiresAt = addDays(JWT_REFRESH_TTL_DAYS);
    await AdminAccessToken.create({
      adminUserId: admin._id,
      token: newToken,
      refreshToken: newRefreshToken,
      active: true,
      deleted: false,
      expiresAt,
    });

    await redisClient.set(
      `admin_session:${admin._id.toString()}`,
      newToken,
      "EX",
      JWT_ACCESS_TTL_DAYS * 24 * 60 * 60
    );

    return { 
      ok: true, 
      message: "Token refreshed successfully.", 
      token: newToken, 
      refreshToken: newRefreshToken, 
      admin: {
        id: admin._id,
        firstName: admin.firstName,
        lastName: admin.lastName ?? "",
        email: admin.email,
        role: admin.role,
        roles: admin.roles ?? [],
        permissions: admin.permissions ?? [],
        image: admin.image ?? "",
        isDark: admin.isDark,
      } 
    };
  } catch (err) {
    return { ok: false, message: "Invalid or expired refresh token." };
  }
}

export async function logoutAdmin(adminId: string) {
  try {
    await AdminAccessToken.updateMany(
      { adminUserId: adminId },
      { active: false, deleted: true }
    );
    await redisClient.del(`admin_session:${adminId}`);
    return { ok: true, message: "Successfully logged out." };
  } catch (error) {
    console.error("[logoutAdmin error]", error);
    return { ok: false, message: "Failed to logout securely." };
  }
}

// ─── Profile Update ────────────────────────────────────────────────────────
export async function updateAdminProfile(
  adminId: string,
  data: { firstName?: string; lastName?: string; image?: string }
): Promise<{ ok: boolean; message: string; admin?: Record<string, unknown> }> {
  const admin = await AdminUser.findById(adminId);
  if (!admin) {
    return { ok: false, message: "Admin not found." };
  }

  if (data.firstName !== undefined) admin.firstName = data.firstName;
  if (data.lastName !== undefined) admin.lastName = data.lastName;
  
  if (data.image !== undefined) {
    // If the admin already has an image, and it's being replaced, delete the old one from S3 securely.
    if (admin.image && admin.image !== data.image) {
      deleteFromS3FileUrl(admin.image).catch((err) =>
        console.error("Non-fatal: Failed to delete old admin profile image from S3:", err)
      );
    }
    admin.image = data.image;
  }

  await admin.save();

  return {
    ok: true,
    message: "Admin profile updated successfully.",
    admin: {
      id: admin._id,
      firstName: admin.firstName,
      lastName: admin.lastName ?? "",
      email: admin.email,
      role: admin.role,
      roles: admin.roles ?? [],
      permissions: admin.permissions ?? [],
      image: admin.image ?? "",
      isDark: admin.isDark,
    },
  };
}
