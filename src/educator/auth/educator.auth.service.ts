import bcrypt from "bcryptjs";
import { CourseEducator } from "../../models/course/CourseEducator.model";
import { EducatorAccessToken } from "../../models/educator/EducatorAccessToken.model";
import { redisClient } from "../../config/redis";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../../utils/jwtSigner";
import logger from "../../utils/logger";

// JWT secrets routed through the keyring (config/jwtKeys.ts) — same pattern
// as the customer + admin auth services.
const JWT_ACCESS_TTL_DAYS = 1;
const JWT_REFRESH_TTL_DAYS = 30;
const SALT_ROUNDS = 10;

const addDays = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

const buildProfile = (e: any) => ({
  id: e._id,
  name: e.name,
  email: e.email,
  image: e.image ?? "",
  about: e.about ?? "",
  view: e.view ?? 0,
  status: e.status,
});

export async function educatorLogin(email: string, password: string, traceId?: string) {
  logger.info("educatorLogin service invoked", { traceId, email });

  const educator = await CourseEducator.findOne({
    email: email.toLowerCase().trim(),
    status: true,
  });
  if (!educator) { logger.warn("educatorLogin service invalid credentials", { traceId, email }); return { ok: false, message: "Invalid email or password." }; }

  if (!educator.password) { logger.warn("educatorLogin service no password set", { traceId, educatorId: educator._id }); return { ok: false, message: "Account has no password set." }; }

  const match = await bcrypt.compare(password, educator.password);
  if (!match) { logger.warn("educatorLogin service invalid credentials", { traceId, email }); return { ok: false, message: "Invalid email or password." }; }

  await EducatorAccessToken.updateMany(
    { educatorId: educator._id },
    { active: false, deleted: true }
  );

  const tokenPayload = {
    id: educator._id.toString(),
    email: educator.email,
    role: "educator",
    type: "educator",
  };
  const token = signAccessToken(tokenPayload, {
    expiresIn: `${JWT_ACCESS_TTL_DAYS}d`,
  });
  const refreshToken = signRefreshToken(tokenPayload, {
    expiresIn: `${JWT_REFRESH_TTL_DAYS}d`,
  });

  await EducatorAccessToken.create({
    educatorId: educator._id,
    token,
    refreshToken,
    active: true,
    deleted: false,
    expiresAt: addDays(JWT_REFRESH_TTL_DAYS),
  });

  await redisClient.set(
    `educator_session:${educator._id.toString()}`,
    token,
    "EX",
    JWT_ACCESS_TTL_DAYS * 24 * 60 * 60
  );

  logger.info("educatorLogin service success", { traceId, educatorId: educator._id });
  return {
    ok: true,
    message: "Login successful.",
    token,
    refreshToken,
    educator: buildProfile(educator),
  };
}

export async function educatorRefresh(refreshToken: string, traceId?: string) {
  logger.info("educatorRefresh service invoked", { traceId });
  if (!refreshToken) { logger.warn("educatorRefresh service missing token", { traceId }); return { ok: false, message: "Refresh token is required." }; }
  try {
    const decoded = verifyRefreshToken<any>(refreshToken);
    const educatorId = decoded.id;

    const db = await EducatorAccessToken.findOne({
      refreshToken,
      educatorId,
      active: true,
      deleted: false,
    });
    if (!db) { logger.warn("educatorRefresh service revoked", { traceId, educatorId }); return { ok: false, message: "Invalid or revoked refresh token." }; }

    const educator = await CourseEducator.findOne({ _id: educatorId, status: true });
    if (!educator) { logger.warn("educatorRefresh service educator not found", { traceId, educatorId }); return { ok: false, message: "Educator not found or disabled." }; }

    await EducatorAccessToken.updateOne({ _id: db._id }, { active: false, deleted: true });

    const refreshPayload = {
      id: educator._id.toString(),
      email: educator.email,
      role: "educator",
      type: "educator",
    };
    const newToken = signAccessToken(refreshPayload, {
      expiresIn: `${JWT_ACCESS_TTL_DAYS}d`,
    });
    const newRefreshToken = signRefreshToken(refreshPayload, {
      expiresIn: `${JWT_REFRESH_TTL_DAYS}d`,
    });

    await EducatorAccessToken.create({
      educatorId: educator._id,
      token: newToken,
      refreshToken: newRefreshToken,
      active: true,
      deleted: false,
      expiresAt: addDays(JWT_REFRESH_TTL_DAYS),
    });
    await redisClient.set(
      `educator_session:${educator._id.toString()}`,
      newToken,
      "EX",
      JWT_ACCESS_TTL_DAYS * 24 * 60 * 60
    );

    logger.info("educatorRefresh service success", { traceId, educatorId: educator._id });
    return {
      ok: true,
      message: "Token refreshed successfully.",
      token: newToken,
      refreshToken: newRefreshToken,
      educator: buildProfile(educator),
    };
  } catch (err) {
    logger.error("educatorRefresh service error", { traceId, error: (err as Error).message, stack: (err as Error).stack });
    return { ok: false, message: "Invalid or expired refresh token." };
  }
}

export async function educatorLogout(educatorId: string, traceId?: string) {
  logger.info("educatorLogout service invoked", { traceId, educatorId });
  await EducatorAccessToken.updateMany(
    { educatorId },
    { active: false, deleted: true }
  );
  await redisClient.del(`educator_session:${educatorId}`);
  logger.info("educatorLogout service success", { traceId, educatorId });
  return { ok: true, message: "Successfully logged out." };
}

export async function educatorChangePassword(
  educatorId: string,
  currentPassword: string,
  newPassword: string,
  traceId?: string
) {
  logger.info("educatorChangePassword service invoked", { traceId, educatorId });
  const educator = await CourseEducator.findById(educatorId);
  if (!educator) { logger.warn("educatorChangePassword service educator not found", { traceId, educatorId }); return { ok: false, message: "Educator not found." }; }
  if (!educator.password) { logger.warn("educatorChangePassword service no password set", { traceId, educatorId }); return { ok: false, message: "No current password set." }; }

  const match = await bcrypt.compare(currentPassword, educator.password);
  if (!match) { logger.warn("educatorChangePassword service wrong current password", { traceId, educatorId }); return { ok: false, message: "Current password is incorrect." }; }

  educator.password = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await educator.save();
  logger.info("educatorChangePassword service success", { traceId, educatorId });
  return { ok: true, message: "Password updated successfully." };
}

export async function educatorUpdateProfile(
  educatorId: string,
  data: { name?: string; about?: string; image?: string },
  traceId?: string
) {
  logger.info("educatorUpdateProfile service invoked", { traceId, educatorId });
  const educator = await CourseEducator.findById(educatorId);
  if (!educator) { logger.warn("educatorUpdateProfile service educator not found", { traceId, educatorId }); return { ok: false, message: "Educator not found." }; }

  if (data.name !== undefined) educator.name = data.name;
  if (data.about !== undefined) educator.about = data.about;
  if (data.image !== undefined) educator.image = data.image;
  await educator.save();
  logger.info("educatorUpdateProfile service success", { traceId, educatorId });
  return { ok: true, message: "Profile updated.", educator: buildProfile(educator) };
}

export async function educatorGetProfile(educatorId: string, traceId?: string) {
  logger.info("educatorGetProfile service invoked", { traceId, educatorId });
  const educator = await CourseEducator.findById(educatorId);
  if (!educator) { logger.warn("educatorGetProfile service educator not found", { traceId, educatorId }); return { ok: false, message: "Educator not found." }; }
  logger.info("educatorGetProfile service success", { traceId, educatorId });
  return { ok: true, message: "ok", educator: buildProfile(educator) };
}
