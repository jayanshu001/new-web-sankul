import bcrypt from "bcryptjs";
import { Promoter } from "../../models/promoter/Promoter.model";
import { PromoterAccessToken } from "../../models/promoter/PromoterAccessToken.model";
import { redisClient } from "../../config/redis";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../../utils/jwtSigner";
import logger from "../../utils/logger";
import { isMysqlModule } from "../../config/migration";
import { promoterAuthRepository as repo } from "../../modules/promoter-auth/promoter-auth.repository";
import {
  toPromoterAuthDto,
  verifyPromoterPassword,
} from "../../modules/promoter-auth/promoter-auth.transformer";

// JWT secrets routed through the keyring (config/jwtKeys.ts).
const JWT_ACCESS_TTL_DAYS = 1;
const JWT_REFRESH_TTL_DAYS = 30;
const SALT_ROUNDS = 10;
const MODULE = "promoter-auth";

const addDays = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

/** Parse a JWT/route promoter id ("2") to a positive int; null if invalid. */
const parsePromoterId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const buildProfile = (p: any) => ({
  id: p._id,
  fullName: p.fullName,
  email: p.email,
  phone: p.phone,
  image: p.image ?? "",
  status: p.status,
});

export async function promoterLogin(email: string, password: string, ip?: string, traceId?: string) {
  logger.info("promoterLogin service invoked", { traceId, email, ip });

  // ─── MySQL branch (ws_promoter) ─────────────────────────────────────────
  if (isMysqlModule(MODULE)) {
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

  const promoter = await Promoter.findOne({
    email: email.toLowerCase().trim(),
    status: true,
    isDelete: false,
  }).select("+password");
  if (!promoter) { logger.warn("promoterLogin service invalid credentials", { traceId, email }); return { ok: false, message: "Invalid email or password." }; }
  if (!promoter.password) { logger.warn("promoterLogin service no password set", { traceId, promoterId: promoter._id }); return { ok: false, message: "Account has no password set." }; }

  const match = await bcrypt.compare(password, promoter.password);
  if (!match) { logger.warn("promoterLogin service invalid credentials", { traceId, email }); return { ok: false, message: "Invalid email or password." }; }

  await PromoterAccessToken.updateMany(
    { promoterId: promoter._id },
    { active: false, deleted: true }
  );

  promoter.lastLoginDate = new Date();
  if (ip) promoter.lastLoginIp = ip;
  await promoter.save();

  const tokenPayload = {
    id: promoter._id.toString(),
    email: promoter.email,
    role: "promoter",
    type: "promoter",
  };
  const token = signAccessToken(tokenPayload, {
    expiresIn: `${JWT_ACCESS_TTL_DAYS}d`,
  });
  const refreshToken = signRefreshToken(tokenPayload, {
    expiresIn: `${JWT_REFRESH_TTL_DAYS}d`,
  });

  await PromoterAccessToken.create({
    promoterId: promoter._id,
    token,
    refreshToken,
    active: true,
    deleted: false,
    expiresAt: addDays(JWT_REFRESH_TTL_DAYS),
  });

  await redisClient.set(
    `promoter_session:${promoter._id.toString()}`,
    token,
    "EX",
    JWT_ACCESS_TTL_DAYS * 24 * 60 * 60
  );

  logger.info("promoterLogin service success", { traceId, promoterId: promoter._id });
  return {
    ok: true,
    message: "Login successful.",
    token,
    refreshToken,
    promoter: buildProfile(promoter),
  };
}

export async function promoterRefresh(refreshToken: string, traceId?: string) {
  logger.info("promoterRefresh service invoked", { traceId });
  if (!refreshToken) { logger.warn("promoterRefresh service missing token", { traceId }); return { ok: false, message: "Refresh token is required." }; }

  // ─── MySQL branch (ws_promoter) ─────────────────────────────────────────
  if (isMysqlModule(MODULE)) {
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

  try {
    const decoded = verifyRefreshToken<any>(refreshToken);
    const promoterId = decoded.id;

    const db = await PromoterAccessToken.findOne({
      refreshToken,
      promoterId,
      active: true,
      deleted: false,
    });
    if (!db) { logger.warn("promoterRefresh service revoked", { traceId, promoterId }); return { ok: false, message: "Invalid or revoked refresh token." }; }

    const promoter = await Promoter.findOne({
      _id: promoterId,
      status: true,
      isDelete: false,
    });
    if (!promoter) { logger.warn("promoterRefresh service promoter not found", { traceId, promoterId }); return { ok: false, message: "Promoter not found or disabled." }; }

    await PromoterAccessToken.updateOne({ _id: db._id }, { active: false, deleted: true });

    const refreshPayload = {
      id: promoter._id.toString(),
      email: promoter.email,
      role: "promoter",
      type: "promoter",
    };
    const newToken = signAccessToken(refreshPayload, {
      expiresIn: `${JWT_ACCESS_TTL_DAYS}d`,
    });
    const newRefreshToken = signRefreshToken(refreshPayload, {
      expiresIn: `${JWT_REFRESH_TTL_DAYS}d`,
    });

    await PromoterAccessToken.create({
      promoterId: promoter._id,
      token: newToken,
      refreshToken: newRefreshToken,
      active: true,
      deleted: false,
      expiresAt: addDays(JWT_REFRESH_TTL_DAYS),
    });
    await redisClient.set(
      `promoter_session:${promoter._id.toString()}`,
      newToken,
      "EX",
      JWT_ACCESS_TTL_DAYS * 24 * 60 * 60
    );

    logger.info("promoterRefresh service success", { traceId, promoterId: promoter._id });
    return {
      ok: true,
      message: "Token refreshed successfully.",
      token: newToken,
      refreshToken: newRefreshToken,
      promoter: buildProfile(promoter),
    };
  } catch (err) {
    logger.error("promoterRefresh service error", { traceId, error: (err as Error).message, stack: (err as Error).stack });
    return { ok: false, message: "Invalid or expired refresh token." };
  }
}

export async function promoterLogout(promoterId: string, traceId?: string) {
  logger.info("promoterLogout service invoked", { traceId, promoterId });

  if (isMysqlModule(MODULE)) {
    const id = parsePromoterId(promoterId);
    if (id) await repo.deactivateAllTokens(id);
    await redisClient.del(`promoter_session:${promoterId}`);
    logger.info("promoterLogout success (sql)", { traceId, promoterId });
    return { ok: true, message: "Successfully logged out." };
  }

  await PromoterAccessToken.updateMany({ promoterId }, { active: false, deleted: true });
  await redisClient.del(`promoter_session:${promoterId}`);
  logger.info("promoterLogout service success", { traceId, promoterId });
  return { ok: true, message: "Successfully logged out." };
}

export async function promoterChangePassword(
  promoterId: string,
  currentPassword: string,
  newPassword: string,
  traceId?: string
) {
  logger.info("promoterChangePassword service invoked", { traceId, promoterId });

  if (isMysqlModule(MODULE)) {
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

  const promoter = await Promoter.findById(promoterId).select("+password");
  if (!promoter) { logger.warn("promoterChangePassword service promoter not found", { traceId, promoterId }); return { ok: false, message: "Promoter not found." }; }
  if (!promoter.password) { logger.warn("promoterChangePassword service no password set", { traceId, promoterId }); return { ok: false, message: "No current password set." }; }

  const match = await bcrypt.compare(currentPassword, promoter.password);
  if (!match) { logger.warn("promoterChangePassword service wrong current password", { traceId, promoterId }); return { ok: false, message: "Current password is incorrect." }; }

  promoter.password = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await promoter.save();
  logger.info("promoterChangePassword service success", { traceId, promoterId });
  return { ok: true, message: "Password updated successfully." };
}

export async function promoterUpdateProfile(
  promoterId: string,
  data: { fullName?: string; phone?: string; image?: string },
  traceId?: string
) {
  logger.info("promoterUpdateProfile service invoked", { traceId, promoterId });

  if (isMysqlModule(MODULE)) {
    const id = parsePromoterId(promoterId);
    if (!id) return { ok: false, message: "Promoter not found." };
    const existing = await repo.findById(id);
    if (!existing) { logger.warn("promoterUpdateProfile promoter not found (sql)", { traceId, promoterId }); return { ok: false, message: "Promoter not found." }; }
    const updated = await repo.updateProfile(id, data);
    logger.info("promoterUpdateProfile success (sql)", { traceId, promoterId });
    return { ok: true, message: "Profile updated.", promoter: toPromoterAuthDto(updated) };
  }

  const promoter = await Promoter.findById(promoterId);
  if (!promoter) { logger.warn("promoterUpdateProfile service promoter not found", { traceId, promoterId }); return { ok: false, message: "Promoter not found." }; }

  if (data.fullName !== undefined) promoter.fullName = data.fullName;
  if (data.phone !== undefined) promoter.phone = data.phone;
  if (data.image !== undefined) promoter.image = data.image;
  await promoter.save();
  logger.info("promoterUpdateProfile service success", { traceId, promoterId });
  return { ok: true, message: "Profile updated.", promoter: buildProfile(promoter) };
}

export async function promoterGetProfile(promoterId: string, traceId?: string) {
  logger.info("promoterGetProfile service invoked", { traceId, promoterId });

  if (isMysqlModule(MODULE)) {
    const id = parsePromoterId(promoterId);
    if (!id) return { ok: false, message: "Promoter not found." };
    const row = await repo.findById(id);
    if (!row) { logger.warn("promoterGetProfile promoter not found (sql)", { traceId, promoterId }); return { ok: false, message: "Promoter not found." }; }
    logger.info("promoterGetProfile success (sql)", { traceId, promoterId });
    return { ok: true, message: "ok", promoter: toPromoterAuthDto(row) };
  }

  const promoter = await Promoter.findById(promoterId);
  if (!promoter) { logger.warn("promoterGetProfile service promoter not found", { traceId, promoterId }); return { ok: false, message: "Promoter not found." }; }
  logger.info("promoterGetProfile service success", { traceId, promoterId });
  return { ok: true, message: "ok", promoter: buildProfile(promoter) };
}
