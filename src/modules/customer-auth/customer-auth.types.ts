/**
 * Customer auth — MySQL-side types for the OTP/token flow.
 *
 * Scope: the 3 tables ws_customer, ws_customer_otp, ws_customer_access_token.
 * The shared flow (JWT signing, Redis, OTP/SMS, response shaping) lives in
 * src/client/auth/auth.service.ts; this module supplies the Prisma persistence
 * and the profile transformer for the MySQL branch.
 *
 * Contract notes (decided during planning):
 *  - MySQL `ws_customer` has a single `full_name` (no first/middle/last) and
 *    integer FKs. The login/profile response keeps the Mongo keys: `full_name`
 *    maps to `firstName`, `middleName`/`lastName` = "", state/district/education
 *    ids are returned as strings, `goals` comes from the `goal` JSON column.
 *  - There is no `is_profile_completed` column — it is computed, never persisted.
 *  - `refresh_token` is a migration-added nullable column on
 *    ws_customer_access_token (mirrors the Mongo `refreshToken` field).
 */

/** Login / profile response shape — identical keys to the Mongo branch. */
export interface CustomerProfileDto {
  id: string | number;
  firstName: string;
  middleName: string;
  lastName: string;
  phoneNumber: string;
  emailAddress: string;
  profilePicture: string;
  phone2: string;
  dob: Date | string;
  gender: string;
  stateId: string;
  districtId: string;
  city: string;
  educationId: string;
  language: string;
  goals: unknown[];
  referralCode: string;
  rewardPoints: number;
  osType: string;
  isNewUser: boolean;
  isProfileCompleted: boolean;
}

export interface SetOtpInput {
  otp: string;
  otpExpiresAt: Date;
}

export interface CreateTokenInput {
  customerId: number;
  token: string;
  refreshToken: string;
  expiresAt: Date;
}
