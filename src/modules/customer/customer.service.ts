import { Types } from "mongoose";
import { Customer } from "../../models/customer/Customer.model";

interface IProfileUpdateData {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  email?: string;
  goals?: string[]; // Array of ObjectIds as strings
}

export async function updateCustomerProfile(customerId: string, data: IProfileUpdateData) {
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
      goals: updatedCustomer.goals ?? [],
      referralCode: updatedCustomer.referralCode ?? "",
      rewardPoints: updatedCustomer.rewardPoints ?? 0,
      osType: updatedCustomer.osType,
      isNewUser: !updatedCustomer.verified,
    };

    return { ok: true, message: "Profile updated successfully.", data: profile };
  } catch (error) {
    console.error("[updateCustomerProfile service error]", error);
    return { ok: false, message: "An error occurred while updating profile." };
  }
}
