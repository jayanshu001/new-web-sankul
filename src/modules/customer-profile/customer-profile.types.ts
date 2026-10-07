// Customer profile: DTO and input types.
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

export interface ProfileUpdateInput {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  email?: string;
  // [{ goalId, labelIds }]; legacy flat id arrays are still accepted on read.
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
