// Offline enquiries: row to DTO mapping (response shape is frozen).
import type { OfflineEnquiry } from "@prisma/client";
import type { BatchEnquiryDto, EnquiryDto } from "./offline-enquiry.types";

/** `mobile` BigInt → string; `customer_id` 0 sentinel → null (anonymous). */
export const toEnquiryDto = (row: OfflineEnquiry): EnquiryDto => ({
  _id: String(row.id),
  customerId: row.userId && row.userId > 0 ? row.userId : null,
  name: row.name,
  email: row.email,
  mobile: row.mobile != null ? row.mobile.toString() : "",
  qualification: row.qualification,
  batchId: String(row.batchId),
  createdAt: row.createdAt ?? null,
});

/** `updatedAt` is always null: ws_offline_enquiry has no updated_at column. */
export const toBatchEnquiryDto = (row: OfflineEnquiry): BatchEnquiryDto => ({
  _id: String(row.id),
  customerId: row.userId && row.userId > 0 ? row.userId : null,
  name: row.name,
  email: row.email,
  mobile: row.mobile != null ? row.mobile.toString() : "",
  qualification: row.qualification,
  otherQualification: row.otherQualification ?? null,
  batchId: String(row.batchId),
  createdAt: row.createdAt ?? null,
  updatedAt: null,
});
