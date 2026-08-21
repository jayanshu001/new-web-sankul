import type { Prisma } from "@prisma/client";
import { adminCustomerRepository as repo } from "./admin-customer.repository";
import {
  composeFullName,
  toCustomerDto,
  type CustomerDto,
} from "./admin-customer.transformer";

/** Parse a positive integer id from a string; null if invalid. */
export const parseCustomerId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const parseIntId = (v?: string | null): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

/** Shared input shape from the admin customer validation (Mongo-style names). */
export interface CustomerWriteInput {
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  phoneNumber?: string | null;
  phone2?: string | null;
  emailAddress?: string | null;
  dob?: string | null;
  gender?: string | null;
  stateId?: string | null;
  districtId?: string | null;
  city?: string | null;
  educationId?: string | null;
  language?: string | null;
  goals?: string[];
  profilePicture?: string | null;
  status?: boolean;
}

export const listCustomers = async (opts: {
  search?: string;
  status?: boolean;
  stateId?: string;
  districtId?: string;
  fromDate?: string;
  toDate?: string;
  page: number;
  limit: number;
}): Promise<{ items: CustomerDto[]; total: number }> => {
  const where = {
    search: opts.search,
    status: opts.status,
    stateId: parseIntId(opts.stateId),
    districtId: parseIntId(opts.districtId),
    fromDate: opts.fromDate ? new Date(opts.fromDate) : undefined,
    toDate: opts.toDate ? new Date(opts.toDate) : undefined,
  };
  const skip = (opts.page - 1) * opts.limit;
  const [rows, total] = await Promise.all([
    repo.list({ ...where, skip, take: opts.limit }),
    repo.count(where),
  ]);
  return { items: rows.map(toCustomerDto), total };
};

export const getCustomer = async (id: number): Promise<CustomerDto | null> => {
  const row = await repo.findById(id);
  return row ? toCustomerDto(row) : null;
};

export const phoneInUse = async (phone: string, exceptId?: number): Promise<boolean> =>
  !!(await repo.phoneInUse(phone, exceptId));

export const emailInUse = async (email: string, exceptId?: number): Promise<boolean> =>
  !!(await repo.emailInUse(email, exceptId));

/**
 * Build the scalar/FK fields shared by update. Uses the UNCHECKED update input
 * (raw FK columns) because state/district are NOT NULL in MySQL — clearing them
 * means writing 0 (the legacy sentinel), never NULL.
 */
const buildScalars = (input: CustomerWriteInput): Prisma.CustomerUncheckedUpdateInput => {
  const data: Prisma.CustomerUncheckedUpdateInput = {};

  // Name parts → single full_name (only when at least one part is supplied).
  if (
    input.firstName !== undefined ||
    input.middleName !== undefined ||
    input.lastName !== undefined
  ) {
    data.fullName = composeFullName(input);
  }

  if (input.phoneNumber !== undefined && input.phoneNumber !== null)
    data.phoneNumber = input.phoneNumber;
  if (input.phone2 !== undefined) data.phoneNumber2 = input.phone2;
  if (input.emailAddress !== undefined) data.emailAddress = input.emailAddress;
  if (input.dob !== undefined) data.birthDate = input.dob ? new Date(input.dob) : null;
  if (input.gender !== undefined) data.gender = input.gender;
  if (input.city !== undefined) data.city = input.city;
  if (input.language !== undefined) data.language = input.language;
  if (input.profilePicture !== undefined) data.profile_picture = input.profilePicture;
  if (input.goals !== undefined) data.goal = input.goals as Prisma.InputJsonValue;
  if (input.status !== undefined) data.status = input.status;

  // Lookup FKs (Int). state/district are NOT NULL → default to 0 when cleared;
  // education is nullable → may be set NULL.
  if (input.stateId !== undefined) data.stateId = parseIntId(input.stateId) ?? 0;
  if (input.districtId !== undefined) data.districtId = parseIntId(input.districtId) ?? 0;
  if (input.educationId !== undefined) data.educationId = parseIntId(input.educationId) ?? null;

  return data;
};

export const createCustomer = async (
  input: CustomerWriteInput
): Promise<CustomerDto> => {
  // Use the UNCHECKED create input (raw FK columns) so we can default the
  // NOT-NULL state/district columns to 0 — matching the legacy dump + the
  // customer-auth createStub. NULL on these columns is rejected by MySQL.
  const data: Prisma.CustomerUncheckedCreateInput = {
    phoneNumber: input.phoneNumber!,
    fullName: composeFullName(input),
    phoneNumber2: input.phone2 ?? null,
    emailAddress: input.emailAddress ?? null,
    birthDate: input.dob ? new Date(input.dob) : null,
    gender: input.gender ?? null,
    city: input.city ?? null,
    language: input.language ?? null,
    profile_picture: input.profilePicture ?? null,
    goal: (input.goals ?? []) as Prisma.InputJsonValue,
    stateId: parseIntId(input.stateId) ?? 0,
    districtId: parseIntId(input.districtId) ?? 0,
    educationId: parseIntId(input.educationId) ?? null,
    isPhoneVerified: false,
    verified: false,
    triedOtp: 0,
    isAccountDeleted: false,
    status: input.status ?? true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const row = await repo.createUnchecked(data);
  return toCustomerDto(row);
};

export const updateCustomer = async (
  id: number,
  input: CustomerWriteInput
): Promise<CustomerDto> => {
  const data = buildScalars(input);
  // Changing the phone forces re-verification, matching the Mongo branch.
  if (input.phoneNumber !== undefined && input.phoneNumber !== null) {
    data.isPhoneVerified = false;
  }
  data.updatedAt = new Date();
  const row = await repo.update(id, data);
  return toCustomerDto(row);
};

export const softDeleteCustomer = (id: number) => repo.softDelete(id);

export const setCustomerStatus = (id: number, status: boolean) =>
  repo.setStatus(id, status);

/**
 * Is this educationId a real, ACTIVE ws_customer_education row?
 *
 * Called before create/update because the column has no FK — writing an unknown
 * id "succeeds" and then silently reads back as null. Inactive rows are rejected
 * too: `getPreRequisites` only offers `status: true` options, so an inactive id
 * can only come from a stale form or a hand-made request.
 *
 * `undefined`/`null` (field omitted, or education cleared) is always allowed —
 * the column is nullable.
 */
export const educationIdIsValid = async (
  educationId?: string | null
): Promise<boolean> => {
  if (educationId === undefined || educationId === null || educationId === "") return true;
  const id = parseIntId(educationId);
  if (id === undefined) return false;
  const row = await repo.findEducation(id);
  return !!row && row.status === true;
};

// ─── Pre-requisites ────────────────────────────────────────────────────────
export const getPreRequisites = async () => {
  const [states, educations] = await Promise.all([
    repo.listStates(),
    repo.listEducations(),
  ]);
  return {
    states: states.map((s) => ({ _id: String(s.id), name: s.name, stateCode: s.state_code })),
    educations: educations.map((e) => ({ _id: String(e.id), name: e.name })),
  };
};

export const getDistrictsByState = async (stateId: number) => {
  const rows = await repo.listDistrictsByState(stateId);
  return rows.map((d) => ({ _id: String(d.id), name: d.name }));
};
