import logger from "../../utils/logger";
import { Types } from "mongoose";
import { Customer } from "../../models/customer/Customer.model";
import { CustomerAccessToken } from "../../models/customer/CustomerAccessToken.model";
import { Goal } from "../../models/Goal.model";
import { redisClient } from "../../config/redis";
import { deleteFromS3FileUrl } from "../../middlewares/upload";

const MY_SELECTED_GOALS_CACHE_PREFIX = "cache:client:goals:selected:";
const PROFILE_CACHE_PREFIX = "cache:client:profile:";
const PROFILE_CACHE_TTL_SECONDS = 60 * 5; // 5m

interface IProfileUpdateData {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  email?: string;
  goals?: string[];
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

  try {
    const updatePayload: any = {};

    if (data.firstName !== undefined) updatePayload.firstName = data.firstName;
    if (data.middleName !== undefined) updatePayload.middleName = data.middleName;
    if (data.lastName !== undefined) updatePayload.lastName = data.lastName;
    if (data.phone2 !== undefined) updatePayload.phone2 = data.phone2;
    if (data.dob !== undefined) updatePayload.dob = data.dob ? new Date(data.dob) : null;
    if (data.gender !== undefined) updatePayload.gender = data.gender;
    if (data.stateId !== undefined) updatePayload.stateId = data.stateId || null;
    if (data.districtId !== undefined) updatePayload.districtId = data.districtId || null;
    if (data.city !== undefined) updatePayload.city = data.city;
    if (data.educationId !== undefined) updatePayload.educationId = data.educationId || null;
    if (data.language !== undefined) updatePayload.language = data.language;

    // Explicitly handle goals if provided
    if (data.goals !== undefined) {
      if (!Array.isArray(data.goals)) {
        return { ok: false, message: "Goals must be an array of IDs." };
      }

      // Filter out invalid ObjectIds to prevent Mongoose Casting errors
      const validGoals = data.goals.filter(id => Types.ObjectId.isValid(id));
      updatePayload.goals = validGoals;
    }

    // Verify email uniqueness if an email is provided
    if (data.email) {
      const emailExists = await Customer.findOne({
        emailAddress: data.email,
        _id: { $ne: customerId },
        isAccountDeleted: false,
      });

      if (emailExists) {
        logger.warn("updateCustomerProfile service email conflict", { traceId, customerId, email: data.email });
        return { ok: false, message: "Email address is already in use by another account." };
      }

      updatePayload.emailAddress = data.email;
    }

    // Update the record and return the updated document
    const updatedCustomer = await Customer.findByIdAndUpdate(
      customerId,
      { $set: updatePayload },
      { new: true, runValidators: true }
    ).select(
      "+otp otpExpiresAt triedOtp firstName middleName lastName emailAddress profilePicture phone2 dob gender stateId districtId city educationId language goals referralCode rewardPoints verified firebaseTokens osType loginCount isLoggedIn phoneNumber"
    );

    if (!updatedCustomer) {
      logger.warn("updateCustomerProfile service customer not found", { traceId, customerId });
      return { ok: false, message: "Customer not found." };
    }

    // Shape the output to strictly match what the login endpoint provides
    const profile = {
      id: updatedCustomer._id,
      firstName: updatedCustomer.firstName ?? "",
      middleName: updatedCustomer.middleName ?? "",
      lastName: updatedCustomer.lastName ?? "",
      phoneNumber: updatedCustomer.phoneNumber,
      emailAddress: updatedCustomer.emailAddress ?? "",
      profilePicture: updatedCustomer.profilePicture ?? "",
      phone2: updatedCustomer.phone2 ?? "",
      dob: updatedCustomer.dob ?? "",
      gender: updatedCustomer.gender ?? "",
      stateId: updatedCustomer.stateId ?? "",
      districtId: updatedCustomer.districtId ?? "",
      city: updatedCustomer.city ?? "",
      educationId: updatedCustomer.educationId ?? "",
      language: updatedCustomer.language ?? "",
      goals: (updatedCustomer.goals ?? []) as any[],
      referralCode: updatedCustomer.referralCode ?? "",
      rewardPoints: updatedCustomer.rewardPoints ?? 0,
      osType: updatedCustomer.osType,
      isNewUser: !updatedCustomer.verified,
    };

    // Optimized: Use aggregation to filter subdocuments at the DB level
    if (profile.goals && profile.goals.length > 0) {
      const goalObjectIds = profile.goals.map(id => new Types.ObjectId(id as any));
      const matchedLabels = await Goal.aggregate([
        { $unwind: "$labels" },
        { $match: { "labels._id": { $in: goalObjectIds } } },
        { $project: { _id: "$labels._id", name: "$labels.name" } }
      ]);
      profile.goals = matchedLabels;
    }

    const cacheKey = `${MY_SELECTED_GOALS_CACHE_PREFIX}${customerId}`;
    try {
      const profileCacheKey = `${PROFILE_CACHE_PREFIX}${customerId}`;
      await redisClient.del(cacheKey, profileCacheKey);
      logger.info("updateCustomerProfile cache invalidated", { traceId, customerId, cacheKey, profileCacheKey });
    } catch (err) {
      logger.warn("updateCustomerProfile cache invalidation failed", {
        traceId,
        customerId,
        error: (err as Error).message,
      });
    }

    logger.info("updateCustomerProfile service success", { traceId, customerId, updatedFields: Object.keys(updatePayload) });
    return { ok: true, message: "Profile updated successfully.", data: profile };
  } catch (error) {
    logger.error("updateCustomerProfile service error", { traceId, customerId, error: (error as Error).message, stack: (error as Error).stack });
    return { ok: false, message: "An error occurred while updating profile." };
  }
}

export async function getCustomerProfile(customerId: string, traceId?: string) {
  logger.info("getCustomerProfile service invoked", { traceId, customerId });

  try {
    const cacheKey = `${PROFILE_CACHE_PREFIX}${customerId}`;
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        logger.info("getCustomerProfile cache hit", { traceId, customerId, count: parsed?.goals?.length ?? 0 });
        return { ok: true, message: "Profile fetched successfully.", data: parsed };
      }
    } catch (err) {
      logger.warn("getCustomerProfile cache read failed", {
        traceId,
        customerId,
        error: (err as Error).message,
      });
    }

    const customer = await Customer.findById(customerId).select(
      "+otp otpExpiresAt triedOtp firstName middleName lastName emailAddress profilePicture phone2 dob gender stateId districtId city educationId language goals referralCode rewardPoints verified firebaseTokens osType loginCount isLoggedIn phoneNumber"
    );

    if (!customer) {
      logger.warn("getCustomerProfile service customer not found", { traceId, customerId });
      return { ok: false, message: "Customer not found." };
    }

    const profile = {
      id: customer._id,
      firstName: customer.firstName ?? "",
      middleName: customer.middleName ?? "",
      lastName: customer.lastName ?? "",
      phoneNumber: customer.phoneNumber,
      emailAddress: customer.emailAddress ?? "",
      profilePicture: customer.profilePicture ?? "",
      phone2: customer.phone2 ?? "",
      dob: customer.dob ?? "",
      gender: customer.gender ?? "",
      stateId: customer.stateId ?? "",
      districtId: customer.districtId ?? "",
      city: customer.city ?? "",
      educationId: customer.educationId ?? "",
      language: customer.language ?? "",
      goals: (customer.goals ?? []) as any[],
      referralCode: customer.referralCode ?? "",
      rewardPoints: customer.rewardPoints ?? 0,
      osType: customer.osType,
      isNewUser: !customer.verified,
    };

    // Optimized: Use aggregation to filter subdocuments at the DB level
    if (profile.goals && profile.goals.length > 0) {
      const goalObjectIds = profile.goals.map(id => new Types.ObjectId(id as any));
      const matchedLabels = await Goal.aggregate([
        { $unwind: "$labels" },
        { $match: { "labels._id": { $in: goalObjectIds } } },
        { $project: { _id: "$labels._id", name: "$labels.name" } }
      ]);
      profile.goals = matchedLabels;
    }

    try {
      await redisClient.set(cacheKey, JSON.stringify(profile), "EX", PROFILE_CACHE_TTL_SECONDS);
      logger.info("getCustomerProfile cache written", { traceId, customerId });
    } catch (err) {
      logger.warn("getCustomerProfile cache write failed", {
        traceId,
        customerId,
        error: (err as Error).message,
      });
    }

    logger.info("getCustomerProfile service success", { traceId, customerId });
    return { ok: true, message: "Profile fetched successfully.", data: profile };
  } catch (error) {
    logger.error("getCustomerProfile service error", { traceId, customerId, error: (error as Error).message, stack: (error as Error).stack });
    return { ok: false, message: "An error occurred while fetching profile." };
  }
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

  try {
    const { image } = data;
    if (!image) {
      logger.warn("upsertCustomerProfilePicture missing image", { traceId, customerId });
      return { ok: false, message: "Profile picture image is required." };
    }

    const customer = await Customer.findOne({ _id: customerId, isAccountDeleted: false, status: true }).select(
      "profilePicture"
    );

    if (!customer) {
      logger.warn("upsertCustomerProfilePicture service customer not found", { traceId, customerId });
      return { ok: false, message: "Customer not found." };
    }

    const oldImageUrl = customer.profilePicture;
    if (oldImageUrl && oldImageUrl !== image) {
      // Non-fatal: failure to delete an orphan file shouldn't block the profile update.
      deleteFromS3FileUrl(oldImageUrl).catch((err) => {
        logger.warn("upsertCustomerProfilePicture failed to delete old image", {
          traceId,
          customerId,
          error: (err as Error).message,
        });
      });
    }

    await Customer.updateOne(
      { _id: customerId },
      { $set: { profilePicture: image } },
      { runValidators: true }
    );

    const profileCacheKey = `${PROFILE_CACHE_PREFIX}${customerId}`;
    try {
      await redisClient.del(profileCacheKey);
      logger.info("upsertCustomerProfilePicture cache invalidated", { traceId, customerId, profileCacheKey });
    } catch (err) {
      logger.warn("upsertCustomerProfilePicture cache invalidation failed", {
        traceId,
        customerId,
        error: (err as Error).message,
      });
    }

    logger.info("upsertCustomerProfilePicture service success", { traceId, customerId });
    return { ok: true, message: "Profile picture updated successfully.", data: { profilePicture: image } };
  } catch (error) {
    logger.error("upsertCustomerProfilePicture service error", {
      traceId,
      customerId,
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
    return { ok: false, message: "An error occurred while updating profile picture." };
  }
}

export async function deleteCustomerAccount(customerId: string, traceId?: string) {
  logger.info("deleteCustomerAccount service invoked", { traceId, customerId });
  try {
    const customer = await Customer.findOneAndUpdate(
      { _id: customerId, isAccountDeleted: false },
      { $set: { isAccountDeleted: true, status: false } },
      { new: true }
    );
    if (!customer) {
      logger.warn("deleteCustomerAccount service customer not found", { traceId, customerId });
      return { ok: false, message: "Customer not found." };
    }
    await CustomerAccessToken.updateMany({ customerId }, { active: false, deleted: true });
    await redisClient.del(`customer_session:${customerId}`);
    logger.info("deleteCustomerAccount service completed", { traceId, customerId });
    return { ok: true, message: "Account deleted successfully." };
  } catch (error) {
    logger.error("deleteCustomerAccount service error", { traceId, customerId, error: (error as Error).message });
    return { ok: false, message: "An error occurred while deleting account." };
  }
}

async function upsertFirebaseToken(
  filter: Record<string, unknown>,
  firebaseToken: string,
  platform?: "ios" | "android"
) {
  // Two-step atomic upsert into firebaseTokens[]: pull any existing entry with
  // the same token (carrying stale platform/updatedAt), then push a fresh one.
  // If the same physical device re-registers, this refreshes its row instead
  // of duplicating it, while other devices' tokens remain untouched.
  await Customer.updateOne(filter, { $pull: { firebaseTokens: { token: firebaseToken } } });
  const update: Record<string, unknown> = {
    $push: { firebaseTokens: { token: firebaseToken, platform, updatedAt: new Date() } },
  };
  if (platform) (update as any).$set = { osType: platform };
  return Customer.findOneAndUpdate(filter, update);
}

export async function updateCustomerFirebaseToken(
  phoneNumber: string,
  firebaseToken: string,
  platform?: "ios" | "android",
  traceId?: string
) {
  logger.info("updateCustomerFirebaseToken service invoked", { traceId, phoneNumber });
  try {
    const customer = await upsertFirebaseToken(
      { phoneNumber, isAccountDeleted: false },
      firebaseToken,
      platform
    );
    if (!customer) {
      logger.warn("updateCustomerFirebaseToken service customer not found", { traceId, phoneNumber });
      return { ok: false, message: "Customer not found." };
    }
    logger.info("updateCustomerFirebaseToken service completed", { traceId, phoneNumber });
    return { ok: true, message: "Firebase token updated." };
  } catch (error) {
    logger.error("updateCustomerFirebaseToken service error", { traceId, phoneNumber, error: (error as Error).message });
    return { ok: false, message: "An error occurred while updating firebase token." };
  }
}

export async function registerDeviceToken(
  customerId: string,
  firebaseToken: string,
  platform?: "ios" | "android",
  traceId?: string
) {
  logger.info("registerDeviceToken service invoked", { traceId, customerId });
  try {
    const customer = await upsertFirebaseToken(
      { _id: customerId, isAccountDeleted: false },
      firebaseToken,
      platform
    );
    if (!customer) { logger.warn("registerDeviceToken service customer not found", { traceId, customerId }); return { ok: false, message: "Customer not found." }; }
    logger.info("registerDeviceToken service completed", { traceId, customerId });
    return { ok: true, message: "Device token registered." };
  } catch (error) {
    logger.error("registerDeviceToken service error", { traceId, customerId, error: (error as Error).message, stack: (error as Error).stack });
    return { ok: false, message: "An error occurred while registering device token." };
  }
}

export async function unregisterDeviceToken(
  customerId: string,
  firebaseToken: string,
  traceId?: string
) {
  logger.info("unregisterDeviceToken service invoked", { traceId, customerId });
  try {
    const result = await Customer.updateOne(
      { _id: customerId, isAccountDeleted: false },
      { $pull: { firebaseTokens: { token: firebaseToken } } }
    );
    if (!result.matchedCount) { logger.warn("unregisterDeviceToken service customer not found", { traceId, customerId }); return { ok: false, message: "Customer not found." }; }
    logger.info("unregisterDeviceToken service completed", { traceId, customerId });
    return { ok: true, message: "Device token unregistered." };
  } catch (error) {
    logger.error("unregisterDeviceToken service error", { traceId, customerId, error: (error as Error).message, stack: (error as Error).stack });
    return { ok: false, message: "An error occurred while unregistering device token." };
  }
}

export async function deleteCustomerProfilePicture(customerId: string, traceId?: string) {
  logger.info("deleteCustomerProfilePicture service invoked", { traceId, customerId });

  try {
    const customer = await Customer.findOne({ _id: customerId, isAccountDeleted: false, status: true }).select(
      "profilePicture"
    );

    if (!customer) {
      logger.warn("deleteCustomerProfilePicture service customer not found", { traceId, customerId });
      return { ok: false, message: "Customer not found." };
    }

    const oldImageUrl = customer.profilePicture;
    if (oldImageUrl) {
      // Non-fatal: failure to delete an orphan file shouldn't block the profile update.
      deleteFromS3FileUrl(oldImageUrl).catch((err) => {
        logger.warn("deleteCustomerProfilePicture failed to delete old image", {
          traceId,
          customerId,
          error: (err as Error).message,
        });
      });
    }

    await Customer.updateOne({ _id: customerId }, { $set: { profilePicture: "" } }, { runValidators: true });

    const profileCacheKey = `${PROFILE_CACHE_PREFIX}${customerId}`;
    try {
      await redisClient.del(profileCacheKey);
      logger.info("deleteCustomerProfilePicture cache invalidated", { traceId, customerId, profileCacheKey });
    } catch (err) {
      logger.warn("deleteCustomerProfilePicture cache invalidation failed", {
        traceId,
        customerId,
        error: (err as Error).message,
      });
    }

    logger.info("deleteCustomerProfilePicture service success", { traceId, customerId });
    return { ok: true, message: "Profile picture deleted successfully.", data: { profilePicture: "" } };
  } catch (error) {
    logger.error("deleteCustomerProfilePicture service error", {
      traceId,
      customerId,
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
    return { ok: false, message: "An error occurred while deleting profile picture." };
  }
}

