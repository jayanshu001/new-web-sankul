// Customer profile: row to profile DTO mapping (response shape is frozen).
import type { Customer } from "@prisma/client";
import type { ProfileDto, ProfileGoalDto } from "./customer-profile.types";
import { splitFullName } from "./customer-profile.name";

const idStr = (v: number | null): string => (v === null || v === undefined ? "" : String(v));

/** Not stored: complete when full_name has a token. `verified` alone does not complete it. */
export const deriveProfileCompleted = (row: Pick<Customer, "fullName">): boolean =>
  !!row.fullName && row.fullName.trim().length > 0;

export const toProfileDto = (
  row: Customer,
  goals: { id: number; name: string; labels: { id: number; name: string }[] }[]
): ProfileDto => {
  const { firstName, middleName, lastName } = splitFullName(row.fullName);
  const goalDtos: ProfileGoalDto[] = goals.map((g) => ({
    _id: String(g.id),
    name: g.name,
    labels: g.labels.map((l) => ({ _id: String(l.id), name: l.name })),
  }));

  return {
    id: String(row.id),
    firstName,
    middleName,
    lastName,
    phoneNumber: row.phoneNumber,
    emailAddress: row.emailAddress ?? "",
    profilePicture: row.profile_picture ?? "",
    phone2: row.phoneNumber2 ?? "",
    dob: row.birthDate ?? "",
    gender: row.gender ?? "",
    stateId: idStr(row.stateId),
    districtId: idStr(row.districtId),
    city: row.city ?? "",
    educationId: idStr(row.educationId),
    language: row.language ?? "",
    goals: goalDtos,
    referralCode: row.referralCode ?? "",
    rewardPoints: row.rewardPoints ?? 0,
    osType: row.os_type,
    isNewUser: !row.verified,
    isProfileCompleted: deriveProfileCompleted(row),
  };
};
