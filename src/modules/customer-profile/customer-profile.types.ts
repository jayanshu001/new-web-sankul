/**
 * Customer profile — MySQL (Prisma) branch types.
 *
 * The DTO matches the existing Mongo profile contract field-for-field (the
 * frontend keys off `isProfileCompleted`, `isNewUser`, `goals[]`). Decisions
 * encoded here (see customer-profile.service.ts header for rationale):
 *   - name: split `full_name` → first/middle/last (join on write)
 *   - goals: hydrate JSON int ids → [{ _id, name }] from ws_customer_target_goal
 *   - isProfileCompleted: derived (full_name present), not stored
 *   - device tokens: single `device` column (newest wins), no array
 *   - facebookId: mapped read-only
 */
import type { GoalSelectionInput } from "../../utils/goalSelection";

export interface ProfileGoalLabelDto {
  _id: string;
  name: string;
}

export interface ProfileGoalDto {
  _id: string;
  name: string;
  labels: ProfileGoalLabelDto[];
}

export interface ProfileDto {
  id: string;
  firstName: string;
  middleName: string;
  lastName: string;
  phoneNumber: string;
  emailAddress: string;
  profilePicture: string;
  phone2: string;
  dob: string | Date;
  gender: string;
  stateId: string;
  districtId: string;
  city: string;
  educationId: string;
  language: string;
  goals: ProfileGoalDto[];
  referralCode: string;
  rewardPoints: number;
  osType: string;
  isNewUser: boolean;
  isProfileCompleted: boolean;
}

/** Validated profile-update payload (controller already zod-parses the body). */
export interface ProfileUpdateInput {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  email?: string;
  // Goal selection: array of { goalId, labelIds } (a target goal + the labels
  // chosen within it). Legacy flat id arrays are still accepted on read.
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
