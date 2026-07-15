/**
 * Offline · Enquiry (WRITE — Phase 3b) service — dual-path (MySQL ↔ Mongo).
 *
 * Module key: `offline-enquiry`. Single-table lead-capture write. See types.ts
 * for the drift block (bigint mobile, customer_id 0-sentinel for anonymous, no
 * remarks column). Flag OFF until go-live.
 */
import { offlineEnquiryRepository as repo } from "./offline-enquiry.repository";
import { toBatchEnquiryDto, toEnquiryDto } from "./offline-enquiry.transformer";
import type {
  BatchEnquiryDto,
  BatchEnquiryInput,
  EnquiryDto,
  EnquiryInput,
} from "./offline-enquiry.types";

export {
  OFFLINE_BATCH_QUALIFICATIONS,
  type OfflineBatchQualification,
} from "./offline-enquiry.types";

export const OFFLINE_ENQUIRY_MODULE = "offline-enquiry";

/**
 * Thrown when a customer re-submits a batch enquiry for the same batch AND
 * qualification on the same calendar day. The controller maps this to HTTP 409.
 */
export class DuplicateEnquiryError extends Error {
  constructor(message = "You have already submitted an enquiry for this batch and qualification today.") {
    super(message);
    this.name = "DuplicateEnquiryError";
  }
}

export const isOfflineEnquiryMysql = (): boolean => true;

export const parseOfflineEnquiryId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Does this batch exist? (the controller's existence guard.) */
export const enquiryBatchExists = (batchId: number): Promise<boolean> =>
  repo.batchExists(batchId);

/**
 * Submit an enquiry. `mobile` arrives as a string; digits are parsed to BigInt
 * for the column. Anonymous (customerId null) → stored as the 0 sentinel. The
 * Mongo-only `remarks` field has no SQL column and is intentionally dropped (see
 * types.ts). Returns the created enquiry as the Mongo-shaped DTO.
 */
export const submitEnquiryMysql = async (
  input: EnquiryInput
): Promise<EnquiryDto> => {
  const digits = input.mobile.replace(/\D/g, "");
  const mobile = digits ? BigInt(digits) : BigInt(0);
  const row = await repo.create({
    customerId: input.customerId ?? 0, // 0 sentinel for anonymous (NOT NULL col)
    name: input.name,
    email: input.email,
    mobile,
    qualification: input.qualification,
    batchId: input.batchId,
  });
  return toEnquiryDto(row);
};

/**
 * Submit an offline-batch "Register" enquiry (same table as submitEnquiryMysql,
 * plus `otherQualification`). `mobile` string → BigInt; anonymous (customerId
 * null) → 0 sentinel. `otherQualification` is persisted only when provided
 * (controller passes it only for qualification === "other"). Returns the
 * Mongo-shaped batch-enquiry DTO.
 */
export const submitBatchEnquiryMysql = async (
  input: BatchEnquiryInput
): Promise<BatchEnquiryDto> => {
  // Duplicate guard: block a re-submission for the same batch + qualification by
  // the same logged-in customer on the same calendar day. Skipped for anonymous
  // (0 sentinel) — this route requires auth, so customerId is always real here.
  if (input.customerId && input.customerId > 0) {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date();
    dayEnd.setHours(23, 59, 59, 999);
    const duplicate = await repo.existsSameDayForBatchQualification({
      customerId: input.customerId,
      batchId: input.batchId,
      qualification: input.qualification,
      dayStart,
      dayEnd,
    });
    if (duplicate) throw new DuplicateEnquiryError();
  }

  const digits = input.mobile.replace(/\D/g, "");
  const mobile = digits ? BigInt(digits) : BigInt(0);
  const row = await repo.create({
    customerId: input.customerId ?? 0, // 0 sentinel for anonymous (NOT NULL col)
    name: input.name,
    email: input.email,
    mobile,
    qualification: input.qualification,
    otherQualification: input.otherQualification,
    batchId: input.batchId,
  });
  return toBatchEnquiryDto(row);
};

// ── admin list / delete (Wave 8) ─────────────────────────────────────────────
/** Admin enquiry listing: paginated, batch-populated, name/email search + date range. */
export const listEnquiriesAdmin = async (opts: {
  batchId?: number; search?: string; from?: Date; to?: Date; page: number; limit: number;
}): Promise<{ data: any[]; total: number }> => {
  const skip = (opts.page - 1) * opts.limit;
  const [rows, total] = await repo.list({
    batchId: opts.batchId, search: opts.search, from: opts.from, to: opts.to, skip, take: opts.limit,
  });
  const data = rows.map((r: any) => ({
    ...toEnquiryDto(r),
    // populated batch ref (mirrors Mongo .populate("batchId","name startAt"))
    batchId: r.batch ? { _id: String(r.batch.id), name: r.batch.name, startAt: r.batch.startAt } : String(r.batchId),
  }));
  return { data, total };
};

/** Delete an enquiry; false if not found (→404). */
export const deleteEnquiryAdmin = async (id: number): Promise<boolean> => {
  if (!(await repo.findById(id))) return false;
  await repo.deleteById(id);
  return true;
};
