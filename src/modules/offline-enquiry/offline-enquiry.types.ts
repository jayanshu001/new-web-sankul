/**
 * Offline · Enquiry (WRITE — Phase 3b) — MySQL (Prisma) branch types.
 *
 * Module key: `offline-enquiry`. A small single-table write: a prospective
 * student submits a batch enquiry (name/email/mobile/qualification/batch).
 * Endpoint: POST /client/offline/enquiry (anonymous-allowed; see drift note).
 *
 * ── SCHEMA-DRIFT / FIELD-MAPPING NOTES (verified vs live DDL 2026-06-13) ─────
 *  - **`mobile` is BIGINT** (already fixed to BigInt in the offline-batch pass).
 *    Input arrives as a string (the Mongo schema + the route validate a string);
 *    we parse digits → BigInt for the column and surface it back as a string in
 *    the DTO (Mongo stores/returns mobile as a string).
 *  - **`customer_id` is INT and NOT NULL**, but the route is ANONYMOUS-ALLOWED
 *    (best-effort auth; userId may be null). SQL can't store NULL here. We store
 *    the **`0` sentinel** for anonymous (no FK is enforced; matches the project's
 *    "0 = unset" convention). The DTO surfaces customerId 0 → null to keep the
 *    Mongo shape (Mongo stores the ObjectId or null).
 *  - **NO `remarks` column** on ws_offline_enquiry, though the Mongo enquiry
 *    accepts an optional `remarks`. SQL can't persist it — it is accepted by the
 *    validator (contract-stable) but DROPPED on the SQL write (documented gap;
 *    enquiries are a lead-capture sink, remarks are non-critical).
 *  - **`batch_id` is INT** (Mongo uses an ObjectId). The MySQL branch validates
 *    an int batch id (the migrated id-space) and checks it exists via offline-batch.
 *  - `created_at` defaults to CURRENT_TIMESTAMP.
 *
 * Ids returned as strings (Mongo `_id`-shape) EXCEPT customerId (int|null).
 */

export interface EnquiryInput {
  customerId: number | null; // null → anonymous → stored as 0
  name: string;
  email: string;
  /** Digits-only string; parsed to BigInt for the column. */
  mobile: string;
  qualification: string;
  batchId: number;
}

/**
 * Qualification values surfaced in the offline-batch "Register" form dropdown.
 * When the user picks "other", the free-text lands in `otherQualification`
 * (SQL column `ws_offline_enquiry.other_qualification`). Kept here (not in the
 * legacy Mongoose model) so the client controller stays Mongo-free.
 */
export const OFFLINE_BATCH_QUALIFICATIONS = [
  "post_graduate",
  "graduate",
  "10_plus_2",
  "other",
] as const;
export type OfflineBatchQualification =
  (typeof OFFLINE_BATCH_QUALIFICATIONS)[number];

/**
 * The batch-enquiry "Register" write. Same table as EnquiryInput, but carries
 * `otherQualification` (free-text kept only when qualification === "other").
 */
export interface BatchEnquiryInput {
  customerId: number | null; // null → anonymous → stored as 0
  name: string;
  email: string;
  /** Digits-only string; parsed to BigInt for the column. */
  mobile: string;
  qualification: string;
  /** Free-text; null unless qualification === "other". */
  otherQualification: string | null;
  batchId: number;
}

/** The created enquiry, Mongo-shaped (the response returns the enquiry doc). */
export interface EnquiryDto {
  _id: string;
  /** 0 sentinel → null (anonymous). */
  customerId: number | null;
  name: string;
  email: string;
  /** BigInt column → string (Mongo shape). */
  mobile: string;
  qualification: string;
  batchId: string;
  createdAt: Date | null;
}

/**
 * The created batch enquiry, Mongo-shaped. Adds `otherQualification` over the
 * base enquiry DTO, and preserves the Mongo `timestamps:true` shape by
 * surfacing `updatedAt` — but ws_offline_enquiry has NO updated_at column, so
 * it is always null (no column invented).
 */
export interface BatchEnquiryDto {
  _id: string;
  /** 0 sentinel → null (anonymous). */
  customerId: number | null;
  name: string;
  email: string;
  /** BigInt column → string (Mongo shape). */
  mobile: string;
  qualification: string;
  /** Free-text; null unless qualification === "other". */
  otherQualification: string | null;
  batchId: string;
  createdAt: Date | null;
  /** No SQL column → always null (Mongo timestamps shape). */
  updatedAt: Date | null;
}
