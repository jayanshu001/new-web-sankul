// Customer auth: DTO and input types.
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

export interface CreateTokenInput {
  customerId: number;
  token: string;
  refreshToken: string;
  expiresAt: Date;
}
