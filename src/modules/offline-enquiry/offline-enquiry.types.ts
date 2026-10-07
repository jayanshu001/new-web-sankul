// Offline enquiries: DTO and input types.
/**
 * `ws_offline_enquiry` drift:
 *  - `mobile` is BIGINT: input is a string, digits are parsed to BigInt, and the DTO
 *    returns it as a string.
 *  - `customer_id` is INT NOT NULL but the route allows anonymous callers, so
 *    anonymous is stored as the `0` sentinel and surfaced as `customerId: null`.
 *  - There is no `remarks` column: the validator accepts it but the write drops it.
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

/** When the user picks "other", the free text lands in `otherQualification`. */
export const OFFLINE_BATCH_QUALIFICATIONS = [
  "post_graduate",
  "graduate",
  "10_plus_2",
  "other",
] as const;
export type OfflineBatchQualification =
  (typeof OFFLINE_BATCH_QUALIFICATIONS)[number];

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

export interface EnquiryDto {
  _id: string;
  customerId: number | null;
  name: string;
  email: string;
  mobile: string;
  qualification: string;
  batchId: string;
  createdAt: Date | null;
}

/** `updatedAt` is always null: ws_offline_enquiry has no updated_at column. */
export interface BatchEnquiryDto {
  _id: string;
  customerId: number | null;
  name: string;
  email: string;
  mobile: string;
  qualification: string;
  /** Free-text; null unless qualification === "other". */
  otherQualification: string | null;
  batchId: string;
  createdAt: Date | null;
  updatedAt: Date | null;
}
