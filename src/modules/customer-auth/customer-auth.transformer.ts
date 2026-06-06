import type { Customer } from "@prisma/client";
import type { CustomerProfileDto } from "./customer-auth.types";

/**
 * Derive profile-completion from the MySQL row (no `is_profile_completed`
 * column exists). Mirrors the Mongo `isProfileComplete` helper's intent:
 * complete if the name is filled OR the account is verified (legacy fallback).
 */
export const isProfileCompleteMysql = (row: Customer): boolean => {
  const hasName = !!(row.fullName && row.fullName.trim().length > 0);
  return hasName || row.verified === true;
};

const idToStr = (v: number | null | undefined): string =>
  v === null || v === undefined ? "" : String(v);

/** MySQL customer row → login/profile DTO (keys identical to the Mongo branch). */
export const toCustomerProfileDto = (
  row: Customer,
  opts: { isNewUser: boolean; isProfileCompleted: boolean }
): CustomerProfileDto => ({
  id: row.id,
  // MySQL has a single full_name; map it into firstName, leave the rest blank.
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
