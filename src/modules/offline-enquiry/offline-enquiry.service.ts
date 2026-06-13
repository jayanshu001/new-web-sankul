/**
 * Offline · Enquiry (WRITE — Phase 3b) service — dual-path (MySQL ↔ Mongo).
 *
 * Module key: `offline-enquiry`. Single-table lead-capture write. See types.ts
 * for the drift block (bigint mobile, customer_id 0-sentinel for anonymous, no
 * remarks column). Flag OFF until go-live.
 */
import { isMysqlModule } from "../../config/migration";
import { offlineEnquiryRepository as repo } from "./offline-enquiry.repository";
import { toEnquiryDto } from "./offline-enquiry.transformer";
import type { EnquiryDto, EnquiryInput } from "./offline-enquiry.types";

export const OFFLINE_ENQUIRY_MODULE = "offline-enquiry";

export const isOfflineEnquiryMysql = (): boolean =>
  isMysqlModule(OFFLINE_ENQUIRY_MODULE);

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
