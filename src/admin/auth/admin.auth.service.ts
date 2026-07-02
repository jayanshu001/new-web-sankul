import logger from "../../utils/logger";
import bcrypt from "bcryptjs";
import { redisClient } from "../../config/redis";
import { deleteFromS3FileUrl } from "../../middlewares/upload";
import { adminAuthRepository } from "../../modules/admin-auth/admin-auth.repository";
import { toAdminDto } from "../../modules/admin-auth/admin-auth.transformer";
import {
  createAdministrator,
  emailInUse,
} from "../../modules/admin-auth/administrator.service";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../../utils/jwtSigner";

// JWT secrets now flow through config/jwtKeys.ts → utils/jwtSigner.ts so we
// can rotate keys without invalidating active sessions.
const JWT_ACCESS_TTL_DAYS = 1;
const JWT_REFRESH_TTL_DAYS = 30;
const SALT_ROUNDS = 10;

function addDays(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/** Parse a JWT/route admin id ("52") to bigint; null if not a valid id. */
function parseAdminId(id: string): bigint | null {
  try {
    const n = BigInt(id);
    return n > BigInt(0) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the admin's *effective* permission set and build the shared admin DTO.
 * Effective = permissions granted via the assigned role(s) (spatie
 * ws_role_has_permissions) UNIONED with any directly-assigned per-user perms.
 * The transformer flattens + de-dupes to permission-key strings (and returns the
 * wildcard for super-admins).
 */
async function buildSqlAdminDto(row: Awaited<ReturnType<typeof adminAuthRepository.findActiveByEmail>>) {
  if (!row) throw new Error("buildSqlAdminDto called with null row");
  const roles = await adminAuthRepository.findRoles(row.id);
  const [rolePermissions, directPermissions] = await Promise.all([
    adminAuthRepository.findRolePermissions(roles.map((r) => r.id)),
    adminAuthRepository.findDirectPermissions(row.id),
  ]);
  return toAdminDto(row, roles, [...rolePermissions, ...directPermissions]);
}

// ─── Login ────────────────────────────────────────────────────────────────────
export async function adminLogin(
  email: string,
  password: string,
  ip?: string,
  traceId?: string
): Promise<{ ok: boolean; message: string; token?: string; refreshToken?: string; admin?: Record<string, unknown> }> {
  logger.info("adminLogin service invoked", { traceId, email, ip });

  const row = await adminAuthRepository.findActiveByEmail(email);
  if (!row) {
    logger.warn("adminLogin service invalid credentials (sql)", { traceId, email });
    return { ok: false, message: "Invalid email or password." };
  }

  const isMatch = await bcrypt.compare(password, row.password);
  if (!isMatch) {
    logger.warn("adminLogin service invalid credentials (sql)", { traceId, email });
    return { ok: false, message: "Invalid email or password." };
  }

  await adminAuthRepository.touchLogin(row.id, ip);

  const dto = await buildSqlAdminDto(row);
  const tokenPayload = { id: dto.id, email: dto.email, role: dto.role, type: "admin" };
  const token = signAccessToken(tokenPayload, { expiresIn: `${JWT_ACCESS_TTL_DAYS}d` });
  const refreshToken = signRefreshToken(tokenPayload, { expiresIn: `${JWT_REFRESH_TTL_DAYS}d` });

  await adminAuthRepository.createToken({
    adminUserId: row.id,
    token,
    refreshToken,
    expiresAt: addDays(JWT_REFRESH_TTL_DAYS),
  });

  await redisClient.set(
    `admin_session:${dto.id}`,
    token,
    "EX",
    JWT_ACCESS_TTL_DAYS * 24 * 60 * 60
  );

  logger.info("adminLogin service success (sql)", { traceId, adminId: dto.id });
  return { ok: true, message: "Login successful.", token, refreshToken, admin: dto as unknown as Record<string, unknown> };
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

  // ws_users has no soft-delete column; an existing row (any status) blocks the
  // email. Roles live in spatie pivots (no `role` enum column on ws_users), so
  // the legacy string `role` is not persisted on this branch — the bootstrap
  // create only writes the core administrator row.
  if (await emailInUse(data.email)) {
    logger.warn("createAdminUser service conflict", { traceId, email: data.email });
    return { ok: false, message: "Admin with this email already exists." };
  }

  if (data.password.length < 8) {
    logger.warn("createAdminUser service weak password", { traceId, email: data.email });
    return { ok: false, message: "Password must be at least 8 characters." };
  }

  const hashed = await bcrypt.hash(data.password, SALT_ROUNDS);
  await createAdministrator({
    firstName: data.firstName,
    lastName: data.lastName ?? null,
    email: data.email,
    passwordHash: hashed,
    image: "",
    status: true,
    isDark: false,
  });

  logger.info("createAdminUser service success (sql)", { traceId, email: data.email });
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

  const id = parseAdminId(adminId);
  if (!id) return { ok: false, message: "Admin not found." };
  const row = await adminAuthRepository.findById(id);
  if (!row) {
    logger.warn("changeAdminPassword service admin not found (sql)", { traceId, adminId });
    return { ok: false, message: "Admin not found." };
  }
  const isMatch = await bcrypt.compare(currentPassword, row.password);
  if (!isMatch) {
    logger.warn("changeAdminPassword service wrong current password (sql)", { traceId, adminId });
    return { ok: false, message: "Current password is incorrect." };
  }
  await adminAuthRepository.updatePassword(id, await bcrypt.hash(newPassword, SALT_ROUNDS));
  logger.info("changeAdminPassword service success (sql)", { traceId, adminId });
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
    const decoded = verifyRefreshToken<any>(refreshToken);
    const id = parseAdminId(String(decoded.id));
    if (!id) return { ok: false, message: "Invalid or revoked refresh token." };

    const dbToken = await adminAuthRepository.findActiveTokenByRefresh(refreshToken, id);
    if (!dbToken) {
      logger.warn("refreshAdminToken invalid token (sql)", { traceId });
      return { ok: false, message: "Invalid or revoked refresh token." };
    }

    const row = await adminAuthRepository.findActiveById(id);
    if (!row) {
      logger.warn("refreshAdminToken admin missing or disabled (sql)", { traceId, adminUserId: String(id) });
      return { ok: false, message: "Admin not found or disabled." };
    }

    await adminAuthRepository.deactivateToken(dbToken.id);

    const dto = await buildSqlAdminDto(row);
    const refreshPayload = { id: dto.id, email: dto.email, role: dto.role, type: "admin" };
    const newToken = signAccessToken(refreshPayload, { expiresIn: `${JWT_ACCESS_TTL_DAYS}d` });
    const newRefreshToken = signRefreshToken(refreshPayload, { expiresIn: `${JWT_REFRESH_TTL_DAYS}d` });

    await adminAuthRepository.createToken({
      adminUserId: row.id,
      token: newToken,
      refreshToken: newRefreshToken,
      expiresAt: addDays(JWT_REFRESH_TTL_DAYS),
    });

    await redisClient.set(
      `admin_session:${dto.id}`,
      newToken,
      "EX",
      JWT_ACCESS_TTL_DAYS * 24 * 60 * 60
    );

    logger.info("refreshAdminToken service success (sql)", { traceId, adminUserId: dto.id });
    return { ok: true, message: "Token refreshed successfully.", token: newToken, refreshToken: newRefreshToken, admin: dto };
  } catch (err) {
    logger.error("refreshAdminToken service error (sql)", { traceId, error: (err as Error).message });
    return { ok: false, message: "Invalid or expired refresh token." };
  }
}

export async function logoutAdmin(adminId: string, traceId?: string) {
  logger.info("logoutAdmin service invoked", { traceId, adminId });

  try {
    const id = parseAdminId(adminId);
    if (id) await adminAuthRepository.deactivateAllTokens(id);
    await redisClient.del(`admin_session:${adminId}`);
    logger.info("logoutAdmin service success (sql)", { traceId, adminId });
    return { ok: true, message: "Successfully logged out." };
  } catch (error) {
    logger.error("logoutAdmin service error (sql)", { traceId, adminId, error: (error as Error).message });
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

  const id = parseAdminId(adminId);
  if (!id) return { ok: false, message: "Admin not found." };
  const existing = await adminAuthRepository.findById(id);
  if (!existing) {
    logger.warn("updateAdminProfile service admin not found (sql)", { traceId, adminId });
    return { ok: false, message: "Admin not found." };
  }
  // Replace the old S3 image when a new one is supplied (best-effort cleanup).
  if (data.image !== undefined && existing.image && existing.image !== data.image) {
    deleteFromS3FileUrl(existing.image).catch((err) =>
      console.error("Non-fatal: Failed to delete old admin profile image from S3:", err)
    );
  }
  const updated = await adminAuthRepository.updateProfile(id, data);
  logger.info("updateAdminProfile service success (sql)", { traceId, adminId });
  return {
    ok: true,
    message: "Admin profile updated successfully.",
    admin: (await buildSqlAdminDto(updated)) as unknown as Record<string, unknown>,
  };
}
