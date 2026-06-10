/**
 * Customer profile service — MySQL (Prisma) branch.
 *
 * Gated behind `isMysqlModule("customer-profile")`. The existing Mongo service
 * (`src/client/profile/customer.service.ts`) calls these when the flag is on and
 * keeps its own Mongoose path otherwise. Returns the same `{ ok, message, data }`
 * envelope so the controller is unchanged.
 *
 * Decisions encoded:
 *   - name: split full_name → first/middle/last; join on write
 *   - goals: JSON int ids ↔ [{ _id, name }] via ws_customer_target_goal
 *   - isProfileCompleted: derived (full_name present), not stored
 *   - device tokens: single `device` column (newest wins), no array
 *   - facebookId: read-only (not written here)
 */
import { customerProfileRepository as repo } from "./customer-profile.repository";
import { toProfileDto } from "./customer-profile.transformer";
import { splitFullName, joinFullName } from "./customer-profile.name";
import type { ProfileUpdateInput } from "./customer-profile.types";

export const PROFILE_MODULE = "customer-profile";

type Ok<T> = { ok: true; message: string; data: T };
type Err = { ok: false; message: string };
type Envelope<T> = Ok<T> | Err;

/** Parse a string id to a positive int, else null. */
export const parseProfileId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Read `goal` JSON column → number[] of target-goal ids (tolerant of shapes). */
const readGoalIds = (goal: unknown): number[] => {
  if (!Array.isArray(goal)) return [];
  return goal
    .map((g) => Number(g))
    .filter((n) => Number.isInteger(n) && n > 0);
};

/** Validated profile-update goals (string ids) → int[] for the JSON column. */
const toGoalIntIds = (goals: string[]): number[] =>
  goals.map((g) => Number(g)).filter((n) => Number.isInteger(n) && n > 0);

// ─── Get profile ───────────────────────────────────────────────────────────────
export const getProfile = async (customerId: number): Promise<Envelope<ReturnType<typeof toProfileDto>>> => {
  const row = await repo.findActiveById(customerId);
  if (!row) return { ok: false, message: "Customer not found." };
  const goals = await repo.hydrateGoals(readGoalIds(row.goal));
  return { ok: true, message: "Profile fetched successfully.", data: toProfileDto(row, goals) };
};

// ─── Update profile ─────────────────────────────────────────────────────────────
export const updateProfile = async (
  customerId: number,
  input: ProfileUpdateInput
): Promise<Envelope<ReturnType<typeof toProfileDto>>> => {
  const current = await repo.findActiveById(customerId);
  if (!current) return { ok: false, message: "Customer not found." };

  // Email uniqueness (mirrors Mongo path).
  if (input.email) {
    const taken = await repo.emailTakenByOther(input.email, customerId);
    if (taken) return { ok: false, message: "Email address is already in use by another account." };
  }

  const data: Record<string, unknown> = {};

  // Name: join provided first/middle/last over the existing split.
  if (input.firstName !== undefined || input.middleName !== undefined || input.lastName !== undefined) {
    const existing = splitFullName(current.fullName);
    data.fullName = joinFullName(
      { firstName: input.firstName, middleName: input.middleName, lastName: input.lastName },
      existing
    );
  }

  if (input.email !== undefined) data.emailAddress = input.email;
  if (input.phone2 !== undefined) data.phoneNumber2 = input.phone2;
  if (input.dob !== undefined) data.birthDate = input.dob ? new Date(input.dob) : null;
  if (input.gender !== undefined) data.gender = input.gender;
  if (input.stateId !== undefined) data.stateId = input.stateId ? Number(input.stateId) : null;
  if (input.districtId !== undefined) data.districtId = input.districtId ? Number(input.districtId) : null;
  if (input.city !== undefined) data.city = input.city;
  if (input.educationId !== undefined) data.educationId = input.educationId ? Number(input.educationId) : null;
  if (input.language !== undefined) data.language = input.language;
  if (input.goals !== undefined) {
    if (!Array.isArray(input.goals)) return { ok: false, message: "Goals must be an array of IDs." };
    data.goal = toGoalIntIds(input.goals);
  }
  data.updatedAt = new Date();

  await repo.updateById(customerId, data);
  const updated = await repo.findActiveById(customerId);
  if (!updated) return { ok: false, message: "Customer not found." };
  const goals = await repo.hydrateGoals(readGoalIds(updated.goal));
  return { ok: true, message: "Profile updated successfully.", data: toProfileDto(updated, goals) };
};

// ─── Profile picture ─────────────────────────────────────────────────────────────
/** Returns the previous picture url (for S3 cleanup) or an error. */
export const upsertProfilePicture = async (
  customerId: number,
  image: string
): Promise<Envelope<{ profilePicture: string; previousUrl: string | null }>> => {
  const row = await repo.findLiveById(customerId);
  if (!row) return { ok: false, message: "Customer not found." };
  const previousUrl = row.profile_picture && row.profile_picture !== image ? row.profile_picture : null;
  await repo.setProfilePicture(customerId, image);
  return { ok: true, message: "Profile picture updated successfully.", data: { profilePicture: image, previousUrl } };
};

export const deleteProfilePicture = async (
  customerId: number
): Promise<Envelope<{ profilePicture: string; previousUrl: string | null }>> => {
  const row = await repo.findLiveById(customerId);
  if (!row) return { ok: false, message: "Customer not found." };
  const previousUrl = row.profile_picture || null;
  await repo.setProfilePicture(customerId, "");
  return { ok: true, message: "Profile picture deleted successfully.", data: { profilePicture: "", previousUrl } };
};

// ─── Delete account ──────────────────────────────────────────────────────────────
export const deleteAccount = async (customerId: number): Promise<Envelope<null>> => {
  const res = await repo.softDelete(customerId);
  if (res.count === 0) return { ok: false, message: "Customer not found." };
  return { ok: true, message: "Account deleted successfully.", data: null };
};

// ─── Device tokens (single-token / legacy `device` column) ───────────────────────
export const registerDeviceToken = async (
  customerId: number,
  token: string,
  platform?: string
): Promise<Envelope<null>> => {
  const res = await repo.setDeviceToken(customerId, token, platform);
  if (res.count === 0) return { ok: false, message: "Customer not found." };
  return { ok: true, message: "Device token registered.", data: null };
};

export const unregisterDeviceToken = async (
  customerId: number,
  token: string
): Promise<Envelope<null>> => {
  // Match-or-not, treat as success if the customer exists; clearing a token that
  // isn't the current one is a no-op (other device already replaced it).
  await repo.clearDeviceToken(customerId, token);
  return { ok: true, message: "Device token unregistered.", data: null };
};

export const updateFirebaseTokenByPhone = async (
  phone: string,
  token: string,
  platform?: string
): Promise<Envelope<null>> => {
  const res = await repo.setDeviceTokenByPhone(phone, token, platform);
  if (res.count === 0) return { ok: false, message: "Customer not found." };
  return { ok: true, message: "Firebase token updated.", data: null };
};
