import logger from "../../utils/logger";
import { redisClient } from "../../config/redis";
import type { GoalSelectionInput } from "../../utils/goalSelection";
import { deleteFromS3FileUrl } from "../../middlewares/upload";
import { customerAuthRepository } from "../../modules/customer-auth/customer-auth.repository";
import { invalidateCustomerGate } from "../../middlewares/authenticate";
import {
  parseProfileId,
  getProfile as svcGetProfile,
  updateProfile as svcUpdateProfile,
  upsertProfilePicture as svcUpsertPicture,
  deleteProfilePicture as svcDeletePicture,
  deleteAccount as svcDeleteAccount,
  registerDeviceToken as svcRegisterDevice,
  unregisterDeviceToken as svcUnregisterDevice,
  updateFirebaseTokenByPhone as svcUpdateFirebaseByPhone,
} from "../../modules/customer-profile/customer-profile.service";

const MY_SELECTED_GOALS_CACHE_PREFIX = "cache:client:goals:selected:";
const PROFILE_CACHE_PREFIX = "cache:client:profile:";
const PROFILE_CACHE_TTL_SECONDS = 60 * 5; // 5m

/** Invalidate the per-customer profile + selected-goals caches (best-effort). */
async function invalidateProfileCaches(customerId: string, traceId?: string) {
  try {
    await redisClient.del(
      `${PROFILE_CACHE_PREFIX}${customerId}`,
      `${MY_SELECTED_GOALS_CACHE_PREFIX}${customerId}`
    );
  } catch (err) {
    logger.warn("profile cache invalidation failed", { traceId, customerId, error: (err as Error).message });
  }
}

interface IProfileUpdateData {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  email?: string;
  goals?: GoalSelectionInput[];
  phone2?: string;
  dob?: string;
  gender?: string;
  stateId?: string;
  districtId?: string;
  city?: string;
  educationId?: string;
  language?: string;
}

export async function updateCustomerProfile(customerId: string, data: IProfileUpdateData, traceId?: string) {
  logger.info("updateCustomerProfile service invoked", { traceId, customerId, data });

  const cid = parseProfileId(customerId);
  if (!cid) return { ok: false as const, message: "Customer not found." };
  const result = await svcUpdateProfile(cid, data);
  if (result.ok) await invalidateProfileCaches(customerId, traceId);
  logger.info("updateCustomerProfile service done (mysql)", { traceId, customerId, ok: result.ok });
  return result;
}

export async function getCustomerProfile(customerId: string, traceId?: string) {
  logger.info("getCustomerProfile service invoked", { traceId, customerId });

  const cacheKey = `${PROFILE_CACHE_PREFIX}${customerId}`;
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      logger.info("getCustomerProfile cache hit (mysql)", { traceId, customerId, count: parsed?.goals?.length ?? 0 });
      return { ok: true, message: "Profile fetched successfully.", data: parsed };
    }
  } catch (err) {
    logger.warn("getCustomerProfile cache read failed (mysql)", { traceId, customerId, error: (err as Error).message });
  }

  const cid = parseProfileId(customerId);
  if (!cid) return { ok: false, message: "Customer not found." };
  const result = await svcGetProfile(cid);
  if (result.ok) {
    try {
      await redisClient.set(cacheKey, JSON.stringify(result.data), "EX", PROFILE_CACHE_TTL_SECONDS);
    } catch (err) {
      logger.warn("getCustomerProfile cache write failed (mysql)", { traceId, customerId, error: (err as Error).message });
    }
  }
  return result;
}

interface IProfilePictureUpsertData {
  image: string;
}

export async function upsertCustomerProfilePicture(
  customerId: string,
  data: IProfilePictureUpsertData,
  traceId?: string
) {
  logger.info("upsertCustomerProfilePicture service invoked", { traceId, customerId });

  const { image } = data;
  if (!image) return { ok: false, message: "Profile picture image is required." };
  const cid = parseProfileId(customerId);
  if (!cid) return { ok: false, message: "Customer not found." };
  const result = await svcUpsertPicture(cid, image);
  if (!result.ok) return result;
  if (result.data.previousUrl) {
    deleteFromS3FileUrl(result.data.previousUrl).catch((err) =>
      logger.warn("upsertCustomerProfilePicture failed to delete old image (mysql)", { traceId, customerId, error: (err as Error).message })
    );
  }
  await invalidateProfileCaches(customerId, traceId);
  return { ok: true, message: result.message, data: { profilePicture: result.data.profilePicture } };
}

export async function deleteCustomerAccount(customerId: string, traceId?: string) {
  logger.info("deleteCustomerAccount service invoked", { traceId, customerId });

  const cid = parseProfileId(customerId);
  if (!cid) return { ok: false, message: "Customer not found." };
  const result = await svcDeleteAccount(cid);
  if (!result.ok) return result;
  // Revoke tokens (MySQL ws_customer_access_token) + clear session cache.
  await customerAuthRepository.deactivateTokens(cid);
  await invalidateCustomerGate(cid);
  try {
    await redisClient.del(`customer_session:${customerId}`);
  } catch (err) {
    logger.warn("deleteCustomerAccount cache clear failed (mysql)", { traceId, customerId, error: (err as Error).message });
  }
  logger.info("deleteCustomerAccount service completed (mysql)", { traceId, customerId });
  return { ok: true, message: result.message };
}

export async function updateCustomerFirebaseToken(
  phoneNumber: string,
  firebaseToken: string,
  platform?: "ios" | "android",
  traceId?: string
) {
  logger.info("updateCustomerFirebaseToken service invoked", { traceId, phoneNumber });

  const result = await svcUpdateFirebaseByPhone(phoneNumber, firebaseToken, platform);
  logger.info("updateCustomerFirebaseToken service done (mysql)", { traceId, phoneNumber, ok: result.ok });
  return result.ok ? { ok: true, message: result.message } : result;
}

export async function registerDeviceToken(
  customerId: string,
  firebaseToken: string,
  platform?: "ios" | "android",
  traceId?: string
) {
  logger.info("registerDeviceToken service invoked", { traceId, customerId });

  const cid = parseProfileId(customerId);
  if (!cid) return { ok: false, message: "Customer not found." };
  const result = await svcRegisterDevice(cid, firebaseToken, platform);
  return result.ok ? { ok: true, message: result.message } : result;
}

export async function unregisterDeviceToken(
  customerId: string,
  firebaseToken: string,
  traceId?: string
) {
  logger.info("unregisterDeviceToken service invoked", { traceId, customerId });

  const cid = parseProfileId(customerId);
  if (!cid) return { ok: false, message: "Customer not found." };
  const result = await svcUnregisterDevice(cid, firebaseToken);
  return result.ok ? { ok: true, message: result.message } : result;
}

export async function deleteCustomerProfilePicture(customerId: string, traceId?: string) {
  logger.info("deleteCustomerProfilePicture service invoked", { traceId, customerId });

  const cid = parseProfileId(customerId);
  if (!cid) return { ok: false, message: "Customer not found." };
  const result = await svcDeletePicture(cid);
  if (!result.ok) return result;
  if (result.data.previousUrl) {
    deleteFromS3FileUrl(result.data.previousUrl).catch((err) =>
      logger.warn("deleteCustomerProfilePicture failed to delete old image (mysql)", { traceId, customerId, error: (err as Error).message })
    );
  }
  await invalidateProfileCaches(customerId, traceId);
  return { ok: true, message: result.message, data: { profilePicture: result.data.profilePicture } };
}

