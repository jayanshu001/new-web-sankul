import bcrypt from "bcryptjs";
import { redisClient } from "../../config/redis";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../../utils/jwtSigner";
import logger from "../../utils/logger";
import { revokeAllTokensForUser } from "../../libs/tokenRevocation";
import { promoterAuthRepository as repo } from "../../modules/promoter-auth/promoter-auth.repository";
import {
  toPromoterAuthDto,
  verifyPromoterPassword,
} from "../../modules/promoter-auth/promoter-auth.transformer";

// JWT secrets routed through the keyring (config/jwtKeys.ts).
const JWT_ACCESS_TTL_DAYS = 1;
const JWT_REFRESH_TTL_DAYS = 30;
const SALT_ROUNDS = 10;

const addDays = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

/** Parse a JWT/route promoter id ("2") to a positive int; null if invalid. */
const parsePromoterId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export async function promoterLogin(email: string, password: string, ip?: string, traceId?: string) {
  logger.info("promoterLogin service invoked", { traceId, email, ip });

  const row = await repo.findActiveByEmail(email);
  if (!row) { logger.warn("promoterLogin invalid credentials (sql)", { traceId, email }); return { ok: false, message: "Invalid email or password." }; }
  if (!row.password) { logger.warn("promoterLogin no password set (sql)", { traceId, promoterId: row.id }); return { ok: false, message: "Account has no password set." }; }
  const match = await verifyPromoterPassword(password, row.password);
  if (!match) { logger.warn("promoterLogin invalid credentials (sql)", { traceId, email }); return { ok: false, message: "Invalid email or password." }; }

  await repo.deactivateAllTokens(row.id);
  await repo.touchLogin(row.id);

  const dto = toPromoterAuthDto(row);
  const tokenPayload = { id: dto.id, email: dto.email, role: "promoter", type: "promoter" };
  const token = signAccessToken(tokenPayload, { expiresIn: `${JWT_ACCESS_TTL_DAYS}d` });
  const refreshToken = signRefreshToken(tokenPayload, { expiresIn: `${JWT_REFRESH_TTL_DAYS}d` });

  await repo.createToken({ promoterId: row.id, token, refreshToken, expiresAt: addDays(JWT_REFRESH_TTL_DAYS) });
  await redisClient.set(`promoter_session:${dto.id}`, token, "EX", JWT_ACCESS_TTL_DAYS * 24 * 60 * 60);

  logger.info("promoterLogin success (sql)", { traceId, promoterId: dto.id });
  return { ok: true, message: "Login successful.", token, refreshToken, promoter: dto };
}

export async function promoterRefresh(refreshToken: string, traceId?: string) {
  logger.info("promoterRefresh service invoked", { traceId });
  if (!refreshToken) { logger.warn("promoterRefresh service missing token", { traceId }); return { ok: false, message: "Refresh token is required." }; }

  try {
    const decoded = verifyRefreshToken<any>(refreshToken);
    const id = parsePromoterId(String(decoded.id));
    if (!id) return { ok: false, message: "Invalid or revoked refresh token." };

    const db = await repo.findActiveTokenByRefresh(refreshToken, id);
    if (!db) { logger.warn("promoterRefresh revoked (sql)", { traceId, promoterId: id }); return { ok: false, message: "Invalid or revoked refresh token." }; }

    const row = await repo.findActiveById(id);
    if (!row) { logger.warn("promoterRefresh promoter not found (sql)", { traceId, promoterId: id }); return { ok: false, message: "Promoter not found or disabled." }; }

    await repo.deactivateToken(db.id);

    const dto = toPromoterAuthDto(row);
    const refreshPayload = { id: dto.id, email: dto.email, role: "promoter", type: "promoter" };
    const newToken = signAccessToken(refreshPayload, { expiresIn: `${JWT_ACCESS_TTL_DAYS}d` });
    const newRefreshToken = signRefreshToken(refreshPayload, { expiresIn: `${JWT_REFRESH_TTL_DAYS}d` });

    await repo.createToken({ promoterId: row.id, token: newToken, refreshToken: newRefreshToken, expiresAt: addDays(JWT_REFRESH_TTL_DAYS) });
    await redisClient.set(`promoter_session:${dto.id}`, newToken, "EX", JWT_ACCESS_TTL_DAYS * 24 * 60 * 60);

    logger.info("promoterRefresh success (sql)", { traceId, promoterId: dto.id });
    return { ok: true, message: "Token refreshed successfully.", token: newToken, refreshToken: newRefreshToken, promoter: dto };
  } catch (err) {
    logger.error("promoterRefresh error (sql)", { traceId, error: (err as Error).message });
    return { ok: false, message: "Invalid or expired refresh token." };
  }
}

export async function promoterLogout(promoterId: string, traceId?: string) {
  logger.info("promoterLogout service invoked", { traceId, promoterId });

  // Kill the token that is ALREADY on the device.
  //
  // `deactivateTokens`/`deactivateAllTokens` below only flags the DB rows, and
  // nothing on the request path reads them: `authenticate` validates an access
  // token by signature + this Redis cutoff + the account gate, never by a lookup
  // in ws_*_access_token. So without this line "logout" only blocked the REFRESH
  // call — the access token already in the app kept opening every endpoint until
  // it expired on its own (7 days for customers, 1 day for the staff surfaces).
  // That is exactly the bug the client reported. `/logout-all-devices` always did
  // this; plain logout never did.
  //
  // Fail-open by design (see libs/tokenRevocation.ts): if Redis is unreachable it
  // logs and returns false rather than throwing, so a Redis blip can't make
  // logout fail. Called FIRST so a later teardown failure still leaves the token
  // revoked.
  await revokeAllTokensForUser("promoter", String(promoterId));

  const id = parsePromoterId(promoterId);
  if (id) await repo.deactivateAllTokens(id);
  await redisClient.del(`promoter_session:${promoterId}`);
  logger.info("promoterLogout success (sql)", { traceId, promoterId });
  return { ok: true, message: "Successfully logged out." };
}

export async function promoterChangePassword(
  promoterId: string,
  currentPassword: string,
  newPassword: string,
  traceId?: string
) {
  logger.info("promoterChangePassword service invoked", { traceId, promoterId });

  const id = parsePromoterId(promoterId);
  if (!id) return { ok: false, message: "Promoter not found." };
  const row = await repo.findById(id);
  if (!row) { logger.warn("promoterChangePassword promoter not found (sql)", { traceId, promoterId }); return { ok: false, message: "Promoter not found." }; }
  if (!row.password) { logger.warn("promoterChangePassword no password set (sql)", { traceId, promoterId }); return { ok: false, message: "No current password set." }; }
  const match = await verifyPromoterPassword(currentPassword, row.password);
  if (!match) { logger.warn("promoterChangePassword wrong current password (sql)", { traceId, promoterId }); return { ok: false, message: "Current password is incorrect." }; }
  await repo.updatePassword(id, await bcrypt.hash(newPassword, SALT_ROUNDS));
  logger.info("promoterChangePassword success (sql)", { traceId, promoterId });
  return { ok: true, message: "Password updated successfully." };
}

export async function promoterUpdateProfile(
  promoterId: string,
  data: { fullName?: string; phone?: string; image?: string },
  traceId?: string
) {
  logger.info("promoterUpdateProfile service invoked", { traceId, promoterId });

  const id = parsePromoterId(promoterId);
  if (!id) return { ok: false, message: "Promoter not found." };
  const existing = await repo.findById(id);
  if (!existing) { logger.warn("promoterUpdateProfile promoter not found (sql)", { traceId, promoterId }); return { ok: false, message: "Promoter not found." }; }
  const updated = await repo.updateProfile(id, data);
  logger.info("promoterUpdateProfile success (sql)", { traceId, promoterId });
  return { ok: true, message: "Profile updated.", promoter: toPromoterAuthDto(updated) };
}

export async function promoterGetProfile(promoterId: string, traceId?: string) {
  logger.info("promoterGetProfile service invoked", { traceId, promoterId });

  const id = parsePromoterId(promoterId);
  if (!id) return { ok: false, message: "Promoter not found." };
  const row = await repo.findById(id);
  if (!row) { logger.warn("promoterGetProfile promoter not found (sql)", { traceId, promoterId }); return { ok: false, message: "Promoter not found." }; }
  logger.info("promoterGetProfile success (sql)", { traceId, promoterId });
  return { ok: true, message: "ok", promoter: toPromoterAuthDto(row) };
}
