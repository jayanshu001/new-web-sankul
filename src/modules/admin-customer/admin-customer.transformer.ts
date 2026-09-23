import type {
  Customer,
  CustomerState,
  CustomerDistict,
  CustomerEducation,
} from "@prisma/client";

/**
 * A Customer row with its lookup relations eager-loaded (the shape the
 * repository returns for list/detail). Prisma's generated relation types are
 * loosened here to the fields we actually project.
 */
export type CustomerWithLookups = Customer & {
  state?: Pick<CustomerState, "id" | "name"> | null;
  district?: Pick<CustomerDistict, "id" | "name"> | null;
  education?: Pick<CustomerEducation, "id" | "name"> | null;
};

interface RefDto {
  _id: string;
  name: string;
}

/**
 * SQL `ws_customer` stores a single `full_name`; the Mongo API contract
 * exposes firstName/middleName/lastName. Split best-effort: first token →
 * firstName, last token → lastName (when >1 token), middle tokens → middleName.
 */
const splitFullName = (
  full: string | null | undefined
): { firstName: string; middleName: string | null; lastName: string | null } => {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", middleName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0], middleName: null, lastName: null };
  if (parts.length === 2) return { firstName: parts[0], middleName: null, lastName: parts[1] };
  return {
    firstName: parts[0],
    middleName: parts.slice(1, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
};

/** Compose a single full_name from the API's name parts (create/update). */
export const composeFullName = (parts: {
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
}): string =>
  [parts.firstName, parts.middleName, parts.lastName]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" ");

const toRef = (
  rel: { id: number; name: string } | null | undefined
): RefDto | null => (rel ? { _id: String(rel.id), name: rel.name } : null);

export interface CustomerDto {
  _id: string;
  firstName: string;
  middleName: string | null;
  lastName: string | null;
  phoneNumber: string;
  phone2: string | null;
  emailAddress: string | null;
  dob: Date | null;
  gender: string | null;
  city: string | null;
  language: string | null;
  profilePicture: string | null;
  referralCode: string | null;
  rewardPoints: number | null;
  verified: boolean;
  isPhoneVerified: boolean;
  status: boolean;
  isAccountDeleted: boolean;
  stateId: RefDto | null;
  districtId: RefDto | null;
  educationId: RefDto | null;
  goals: unknown;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export const toCustomerDto = (row: CustomerWithLookups): CustomerDto => {
  const name = splitFullName(row.fullName);
  return {
    _id: String(row.id),
    firstName: name.firstName,
    middleName: name.middleName,
    lastName: name.lastName,
    phoneNumber: row.phoneNumber,
    phone2: row.phoneNumber2 ?? null,
    emailAddress: row.emailAddress ?? null,
    dob: row.birthDate ?? null,
    gender: row.gender ?? null,
    city: row.city ?? null,
    language: row.language ?? null,
    profilePicture: row.profile_picture ?? null,
    referralCode: row.referralCode ?? null,
    rewardPoints: row.rewardPoints ?? null,
    verified: row.verified,
    isPhoneVerified: row.isPhoneVerified,
    status: row.status,
    isAccountDeleted: row.isAccountDeleted,
    stateId: toRef(row.state),
    districtId: toRef(row.district),
    educationId: toRef(row.education),
    goals: row.goal ?? [],
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
};
