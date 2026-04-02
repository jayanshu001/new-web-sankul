import logger from "../../utils/logger";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { AdminUser } from "../../models/admin/AdminUser.model";
import { AdminAccessToken } from "../../models/admin/AdminAccessToken.model";
import { redisClient } from "../../config/redis";
import { deleteFromS3FileUrl } from "../../middlewares/upload";

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
  ip?: string,
  traceId?: string
): Promise<{ ok: boolean; message: string; token?: string; refreshToken?: string; admin?: Record<string, unknown> }> {
  logger.info("adminLogin service invoked", { traceId, email, ip });

  const admin = await AdminUser.findOne({
    email: email.toLowerCase().trim(),
    status: true,
  }).select("+password");

  if (!admin) {
    logger.warn("adminLogin service invalid credentials", { traceId, email });
    return { ok: false, message: "Invalid email or password." };
  }

  const isMatch = await bcrypt.compare(password, admin.password);
  if (!isMatch) {
    logger.warn("adminLogin service invalid credentials", { traceId, email });
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

  logger.info("adminLogin service success", { traceId, adminId: admin._id });
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
}, traceId?: string): Promise<{ ok: boolean; message: string }> {
  logger.info("createAdminUser service invoked", { traceId, email: data.email });

  const exists = await AdminUser.findOne({ email: data.email.toLowerCase() });
  if (exists) {
    logger.warn("createAdminUser service conflict", { traceId, email: data.email });
    return { ok: false, message: "Admin with this email already exists." };
  }

  const hashed = await bcrypt.hash(data.password, SALT_ROUNDS);
  const created = await AdminUser.create({ ...data, password: hashed, email: data.email.toLowerCase() });

  logger.info("createAdminUser service success", { traceId, adminId: created._id });
  return { ok: true, message: "Admin user created successfully." };
}

// ─── Change password ──────────────────────────────────────────────────────────
export async function changeAdminPassword(
  adminId: string,
  currentPassword: string,
  newPassword: string,
  traceId?: string
): Promise<{ ok: boolean; message: string }> {
  logger.info("changeAdminPassword service invoked", { traceId, adminId });

  const admin = await AdminUser.findById(adminId).select("+password");
  if (!admin) {
    logger.warn("changeAdminPassword service admin not found", { traceId, adminId });
    return { ok: false, message: "Admin not found." };
  }

  const isMatch = await bcrypt.compare(currentPassword, admin.password);
  if (!isMatch) {
    logger.warn("changeAdminPassword service wrong current password", { traceId, adminId });
    return { ok: false, message: "Current password is incorrect." };
  }

  admin.password = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await admin.save();

  logger.info("changeAdminPassword service success", { traceId, adminId });
  return { ok: true, message: "Password updated successfully." };
}

// ─── Validation & Refresh ─────────────────────────────────────────────────────
export async function refreshAdminToken(refreshToken: string, traceId?: string) {
  logger.info("refreshAdminToken service invoked", { traceId });

  if (!refreshToken) {
    logger.warn("refreshAdminToken missing token", { traceId });
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
      logger.warn("refreshAdminToken invalid token", { traceId, refreshToken });
      return { ok: false, message: "Invalid or revoked refresh token." };
    }

    const admin = await AdminUser.findOne({ _id: adminUserId, status: true });
    if (!admin) {
      logger.warn("refreshAdminToken admin missing or disabled", { traceId, adminUserId });
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

    logger.info("refreshAdminToken service success", { traceId, adminUserId });
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

export async function logoutAdmin(adminId: string, traceId?: string) {
  logger.info("logoutAdmin service invoked", { traceId, adminId });

  try {
    await AdminAccessToken.updateMany(
      { adminUserId: adminId },
      { active: false, deleted: true }
    );
    await redisClient.del(`admin_session:${adminId}`);

    logger.info("logoutAdmin service success", { traceId, adminId });
    return { ok: true, message: "Successfully logged out." };
  } catch (error) {
    logger.error("logoutAdmin service error", { traceId, adminId, error: (error as Error).message, stack: (error as Error).stack });
    return { ok: false, message: "Failed to logout securely." };
  }
}

// ─── Profile Update ────────────────────────────────────────────────────────
export async function updateAdminProfile(
  adminId: string,
  data: { firstName?: string; lastName?: string; image?: string },
  traceId?: string
): Promise<{ ok: boolean; message: string; admin?: Record<string, unknown> }> {
  logger.info("updateAdminProfile service invoked", { traceId, adminId, data });

  const admin = await AdminUser.findById(adminId);
  if (!admin) {
    logger.warn("updateAdminProfile service admin not found", { traceId, adminId });
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

  logger.info("updateAdminProfile service success", { traceId, adminId });
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
