import logger from "../../utils/logger";
import { Types } from "mongoose";
import { Customer } from "../../models/customer/Customer.model";
import { Goal } from "../../models/Goal.model";

interface IProfileUpdateData {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  email?: string;
  goals?: string[]; // Array of ObjectIds as strings
}

export async function updateCustomerProfile(customerId: string, data: IProfileUpdateData, traceId?: string) {
  logger.info("updateCustomerProfile service invoked", { traceId, customerId, data });

  try {
    const updatePayload: any = {};

    if (data.firstName !== undefined) updatePayload.firstName = data.firstName;
    if (data.middleName !== undefined) updatePayload.middleName = data.middleName;
    if (data.lastName !== undefined) updatePayload.lastName = data.lastName;

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
      "+otp otpExpiresAt triedOtp firstName middleName lastName emailAddress profilePicture phone2 dob gender stateId districtId city educationId language goals referralCode rewardPoints verified firebaseToken osType loginCount isLoggedIn"
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
    const customer = await Customer.findById(customerId).select(
      "+otp otpExpiresAt triedOtp firstName middleName lastName emailAddress profilePicture phone2 dob gender stateId districtId city educationId language goals referralCode rewardPoints verified firebaseToken osType loginCount isLoggedIn"
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

    logger.info("getCustomerProfile service success", { traceId, customerId });
    return { ok: true, message: "Profile fetched successfully.", data: profile };
  } catch (error) {
    logger.error("getCustomerProfile service error", { traceId, customerId, error: (error as Error).message, stack: (error as Error).stack });
    return { ok: false, message: "An error occurred while fetching profile." };
  }
}

