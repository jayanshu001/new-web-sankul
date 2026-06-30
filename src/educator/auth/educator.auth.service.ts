import bcrypt from "bcryptjs";
import { redisClient } from "../../config/redis";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../../utils/jwtSigner";
import logger from "../../utils/logger";
import { educatorAuthRepository as repo } from "../../modules/educator-auth/educator-auth.repository";
import {
  toEducatorDto,
  verifyEducatorPassword,
} from "../../modules/educator-auth/educator-auth.transformer";

// JWT secrets routed through the keyring (config/jwtKeys.ts) — same pattern
// as the customer + admin auth services.
const JWT_ACCESS_TTL_DAYS = 1;
const JWT_REFRESH_TTL_DAYS = 30;
const SALT_ROUNDS = 10;

const addDays = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

/** Parse a JWT/route educator id ("20") to a positive int; null if invalid. */
const parseEducatorId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export async function educatorLogin(email: string, password: string, traceId?: string) {
  logger.info("educatorLogin service invoked", { traceId, email });

  // ─── MySQL branch (ws_course_educator) ──────────────────────────────────
  const row = await repo.findActiveByEmail(email);
  if (!row) {
    logger.warn("educatorLogin service invalid credentials (sql)", { traceId, email });
    return { ok: false, message: "Invalid email or password." };
  }
  if (!row.password) {
    logger.warn("educatorLogin service no password set (sql)", { traceId, educatorId: row.id });
    return { ok: false, message: "Account has no password set." };
  }
  // Legacy rows store MD5; modern rows store bcrypt. verifyEducatorPassword
  // handles both.
  const match = await verifyEducatorPassword(password, row.password);
  if (!match) {
    logger.warn("educatorLogin service invalid credentials (sql)", { traceId, email });
    return { ok: false, message: "Invalid email or password." };
  }

  await repo.deactivateAllTokens(row.id);

  const dto = toEducatorDto(row);
  const tokenPayload = { id: dto.id, email: dto.email, role: "educator", type: "educator" };
  const token = signAccessToken(tokenPayload, { expiresIn: `${JWT_ACCESS_TTL_DAYS}d` });
  const refreshToken = signRefreshToken(tokenPayload, { expiresIn: `${JWT_REFRESH_TTL_DAYS}d` });

  await repo.createToken({ educatorId: row.id, token, refreshToken, expiresAt: addDays(JWT_REFRESH_TTL_DAYS) });
  await redisClient.set(
    `educator_session:${dto.id}`,
    token,
    "EX",
    JWT_ACCESS_TTL_DAYS * 24 * 60 * 60
  );

  logger.info("educatorLogin service success (sql)", { traceId, educatorId: dto.id });
  return { ok: true, message: "Login successful.", token, refreshToken, educator: dto };
}

export async function educatorRefresh(refreshToken: string, traceId?: string) {
  logger.info("educatorRefresh service invoked", { traceId });
  if (!refreshToken) { logger.warn("educatorRefresh service missing token", { traceId }); return { ok: false, message: "Refresh token is required." }; }

  // ─── MySQL branch (ws_course_educator) ──────────────────────────────────
  try {
    const decoded = verifyRefreshToken<any>(refreshToken);
    const id = parseEducatorId(String(decoded.id));
    if (!id) return { ok: false, message: "Invalid or revoked refresh token." };

    const db = await repo.findActiveTokenByRefresh(refreshToken, id);
    if (!db) {
      logger.warn("educatorRefresh service revoked (sql)", { traceId, educatorId: id });
      return { ok: false, message: "Invalid or revoked refresh token." };
    }

    const row = await repo.findActiveById(id);
    if (!row) {
      logger.warn("educatorRefresh service educator not found (sql)", { traceId, educatorId: id });
      return { ok: false, message: "Educator not found or disabled." };
    }

    await repo.deactivateToken(db.id);

    const dto = toEducatorDto(row);
    const refreshPayload = { id: dto.id, email: dto.email, role: "educator", type: "educator" };
    const newToken = signAccessToken(refreshPayload, { expiresIn: `${JWT_ACCESS_TTL_DAYS}d` });
    const newRefreshToken = signRefreshToken(refreshPayload, { expiresIn: `${JWT_REFRESH_TTL_DAYS}d` });

    await repo.createToken({ educatorId: row.id, token: newToken, refreshToken: newRefreshToken, expiresAt: addDays(JWT_REFRESH_TTL_DAYS) });
    await redisClient.set(
      `educator_session:${dto.id}`,
      newToken,
      "EX",
      JWT_ACCESS_TTL_DAYS * 24 * 60 * 60
    );

    logger.info("educatorRefresh service success (sql)", { traceId, educatorId: dto.id });
    return { ok: true, message: "Token refreshed successfully.", token: newToken, refreshToken: newRefreshToken, educator: dto };
  } catch (err) {
    logger.error("educatorRefresh service error (sql)", { traceId, error: (err as Error).message });
    return { ok: false, message: "Invalid or expired refresh token." };
  }
}

export async function educatorLogout(educatorId: string, traceId?: string) {
  logger.info("educatorLogout service invoked", { traceId, educatorId });

  // ─── MySQL branch ───────────────────────────────────────────────────────
  const id = parseEducatorId(educatorId);
  if (id) await repo.deactivateAllTokens(id);
  await redisClient.del(`educator_session:${educatorId}`);
  logger.info("educatorLogout service success (sql)", { traceId, educatorId });
  return { ok: true, message: "Successfully logged out." };
}

export async function educatorChangePassword(
  educatorId: string,
  currentPassword: string,
  newPassword: string,
  traceId?: string
) {
  logger.info("educatorChangePassword service invoked", { traceId, educatorId });

  // ─── MySQL branch ───────────────────────────────────────────────────────
  const id = parseEducatorId(educatorId);
  if (!id) return { ok: false, message: "Educator not found." };
  const row = await repo.findById(id);
  if (!row) {
    logger.warn("educatorChangePassword service educator not found (sql)", { traceId, educatorId });
    return { ok: false, message: "Educator not found." };
  }
  if (!row.password) {
    logger.warn("educatorChangePassword service no password set (sql)", { traceId, educatorId });
    return { ok: false, message: "No current password set." };
  }
  const match = await verifyEducatorPassword(currentPassword, row.password);
  if (!match) {
    logger.warn("educatorChangePassword service wrong current password (sql)", { traceId, educatorId });
    return { ok: false, message: "Current password is incorrect." };
  }
  // New password is always stored as bcrypt (upgrading legacy MD5 on change).
  await repo.updatePassword(id, await bcrypt.hash(newPassword, SALT_ROUNDS));
  logger.info("educatorChangePassword service success (sql)", { traceId, educatorId });
  return { ok: true, message: "Password updated successfully." };
}

export async function educatorUpdateProfile(
  educatorId: string,
  data: { name?: string; about?: string; image?: string },
  traceId?: string
) {
  logger.info("educatorUpdateProfile service invoked", { traceId, educatorId });

  // ─── MySQL branch ───────────────────────────────────────────────────────
  const id = parseEducatorId(educatorId);
  if (!id) return { ok: false, message: "Educator not found." };
  const existing = await repo.findById(id);
  if (!existing) {
    logger.warn("educatorUpdateProfile service educator not found (sql)", { traceId, educatorId });
    return { ok: false, message: "Educator not found." };
  }
  const updated = await repo.updateProfile(id, data);
  logger.info("educatorUpdateProfile service success (sql)", { traceId, educatorId });
  return { ok: true, message: "Profile updated.", educator: toEducatorDto(updated) };
}

export async function educatorGetProfile(educatorId: string, traceId?: string) {
  logger.info("educatorGetProfile service invoked", { traceId, educatorId });

  // ─── MySQL branch ───────────────────────────────────────────────────────
  const id = parseEducatorId(educatorId);
  if (!id) return { ok: false, message: "Educator not found." };
  const row = await repo.findById(id);
  if (!row) {
    logger.warn("educatorGetProfile service educator not found (sql)", { traceId, educatorId });
    return { ok: false, message: "Educator not found." };
  }
  logger.info("educatorGetProfile service success (sql)", { traceId, educatorId });
  return { ok: true, message: "ok", educator: toEducatorDto(row) };
}
