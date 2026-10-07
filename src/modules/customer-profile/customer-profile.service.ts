// Customer profile: profile read/update, picture, account delete and device tokens.
import { customerProfileRepository as repo } from "./customer-profile.repository";
import { toProfileDto } from "./customer-profile.transformer";
import { splitFullName, joinFullName } from "./customer-profile.name";
import type { ProfileUpdateInput } from "./customer-profile.types";
import { parseGoalSelection, parseLabels, type GoalSelection } from "../../utils/goalSelection";
type Ok<T> = { ok: true; message: string; data: T };
type Err = { ok: false; message: string };
type Envelope<T> = Ok<T> | Err;

export const parseProfileId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Lenient by design: unknown goals and labelIds that don't exist on the goal are
 * silently dropped, not rejected.
 */
const buildGoalSelection = async (goals: unknown): Promise<GoalSelection[]> => {
  const parsed = parseGoalSelection(goals);
  if (!parsed.length) return [];
  const rows = await repo.targetGoalsByIds(parsed.map((s) => s.goalId));
  const labelIdsByGoal = new Map(rows.map((r) => [r.id, new Set(parseLabels(r.labels).map((l) => l.id))]));
  const out: GoalSelection[] = [];
  for (const sel of parsed) {
    const validLabelIds = labelIdsByGoal.get(sel.goalId);
    if (!validLabelIds) continue;
    out.push({ goalId: sel.goalId, labelIds: sel.labelIds.filter((id) => validLabelIds.has(id)) });
  }
  return out;
};

export const getProfile = async (customerId: number): Promise<Envelope<ReturnType<typeof toProfileDto>>> => {
  const row = await repo.findActiveById(customerId);
  if (!row) return { ok: false, message: "Customer not found." };
  const goals = await repo.hydrateGoals(parseGoalSelection(row.goal));
  return { ok: true, message: "Profile fetched successfully.", data: toProfileDto(row, goals) };
};

// Partial update: name parts merge into full_name, email must be unique, goals are sanitized.
export const updateProfile = async (
  customerId: number,
  input: ProfileUpdateInput
): Promise<Envelope<ReturnType<typeof toProfileDto>>> => {
  const current = await repo.findActiveById(customerId);
  if (!current) return { ok: false, message: "Customer not found." };

  if (input.email) {
    const taken = await repo.emailTakenByOther(input.email, customerId);
    if (taken) return { ok: false, message: "Email address is already in use by another account." };
  }

  const data: Record<string, unknown> = {};

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
    if (!Array.isArray(input.goals)) return { ok: false, message: "Goals must be an array." };
    data.goal = (await buildGoalSelection(input.goals)) as unknown as object;
  }
  data.updatedAt = new Date();

  await repo.updateById(customerId, data);
  const updated = await repo.findActiveById(customerId);
  if (!updated) return { ok: false, message: "Customer not found." };
  const goals = await repo.hydrateGoals(parseGoalSelection(updated.goal));
  return { ok: true, message: "Profile updated successfully.", data: toProfileDto(updated, goals) };
};

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

// Soft delete; also wipes the offline-download key.
export const deleteAccount = async (customerId: number): Promise<Envelope<null>> => {
  const res = await repo.softDelete(customerId);
  if (res.count === 0) return { ok: false, message: "Customer not found." };
  return { ok: true, message: "Account deleted successfully.", data: null };
};

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
  // Success whenever the customer exists: a non-matching token was already
  // replaced by another device.
  await repo.clearDeviceToken(customerId, token);
  return { ok: true, message: "Device token unregistered.", data: null };
};

// Post-login FCM token sync keyed by phone (no auth context).
export const updateFirebaseTokenByPhone = async (
  phone: string,
  token: string,
  platform?: string
): Promise<Envelope<null>> => {
  const res = await repo.setDeviceTokenByPhone(phone, token, platform);
  if (res.count === 0) return { ok: false, message: "Customer not found." };
  return { ok: true, message: "Firebase token updated.", data: null };
};
