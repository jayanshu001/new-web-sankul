// Customer auth: customer row to login profile DTO.
import type { Customer } from "@prisma/client";
import type { CustomerProfileDto } from "./customer-auth.types";

/** No `is_profile_completed` column: complete if the name is filled or the account is verified. */
export const isProfileCompleteMysql = (row: Customer): boolean => {
  const hasName = !!(row.fullName && row.fullName.trim().length > 0);
  return hasName || row.verified === true;
};

const idToStr = (v: number | null | undefined): string =>
  v === null || v === undefined ? "" : String(v);

export const toCustomerProfileDto = (
  row: Customer,
  opts: { isNewUser: boolean; isProfileCompleted: boolean }
): CustomerProfileDto => ({
  id: row.id,
  // Single full_name column; middle/last stay blank.
  firstName: row.fullName ?? "",
  middleName: "",
  lastName: "",
  phoneNumber: row.phoneNumber,
  emailAddress: row.emailAddress ?? "",
  profilePicture: row.profile_picture ?? "",
  phone2: row.phoneNumber2 ?? "",
  dob: row.birthDate ?? "",
  gender: row.gender ?? "",
  stateId: idToStr(row.stateId),
  districtId: idToStr(row.districtId),
  city: row.city ?? "",
  educationId: idToStr(row.educationId),
  language: row.language ?? "",
  goals: Array.isArray(row.goal) ? (row.goal as unknown[]) : [],
  referralCode: row.referralCode ?? "",
  rewardPoints: row.rewardPoints ?? 0,
  osType: row.os_type,
  isNewUser: opts.isNewUser,
  isProfileCompleted: opts.isProfileCompleted,
});
