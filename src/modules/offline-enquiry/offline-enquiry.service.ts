// Offline enquiries: enquiry and batch enquiry submission plus admin listing.
import { offlineEnquiryRepository as repo } from "./offline-enquiry.repository";
import { toBatchEnquiryDto, toEnquiryDto } from "./offline-enquiry.transformer";
import type {
  BatchEnquiryDto,
  BatchEnquiryInput,
  EnquiryDto,
  EnquiryInput,
} from "./offline-enquiry.types";
import { parsePositiveInt } from "../../utils/parseId";

export {
  OFFLINE_BATCH_QUALIFICATIONS,
  type OfflineBatchQualification,
} from "./offline-enquiry.types";

/** Same batch + qualification re-submitted on the same calendar day; mapped to 409. */
export class DuplicateEnquiryError extends Error {
  constructor(message = "You have already submitted an enquiry for this batch and qualification today.") {
    super(message);
    this.name = "DuplicateEnquiryError";
  }
}

export const parseOfflineEnquiryId = parsePositiveInt;

export const enquiryBatchExists = (batchId: number): Promise<boolean> =>
  repo.batchExists(batchId);

/** The `remarks` input has no SQL column and is intentionally dropped. */
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

/** Batch "Register" enquiry; `otherQualification` is persisted only when provided. */
export const submitBatchEnquiryMysql = async (
  input: BatchEnquiryInput
): Promise<BatchEnquiryDto> => {
  // Anonymous (0 sentinel) is skipped; this route requires auth, so customerId is always real here.
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

export const listEnquiriesAdmin = async (opts: {
  batchId?: number; search?: string; from?: Date; to?: Date; page: number; limit: number;
}): Promise<{ data: any[]; total: number }> => {
  const skip = (opts.page - 1) * opts.limit;
  const [rows, total] = await repo.list({
    batchId: opts.batchId, search: opts.search, from: opts.from, to: opts.to, skip, take: opts.limit,
  });
  const data = rows.map((r: any) => ({
    ...toEnquiryDto(r),
    batchId: r.batch ? { _id: String(r.batch.id), name: r.batch.name, startAt: r.batch.startAt } : String(r.batchId),
  }));
  return { data, total };
};

export const deleteEnquiryAdmin = async (id: number): Promise<boolean> => {
  if (!(await repo.findById(id))) return false;
  await repo.deleteById(id);
  return true;
};
