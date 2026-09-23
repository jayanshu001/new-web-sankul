import type { OfflineEnquiry } from "@prisma/client";
import type { BatchEnquiryDto, EnquiryDto } from "./offline-enquiry.types";

/**
 * SQL ws_offline_enquiry row → the Mongo-shaped enquiry doc (the response
 * returns the created enquiry). `mobile` BigInt → string; `customer_id` 0
 * sentinel → null (anonymous).
 */
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

/**
 * SQL ws_offline_enquiry row → the Mongo-shaped batch-enquiry doc. Same as
 * toEnquiryDto but surfaces `otherQualification` and the Mongo `updatedAt`
 * (always null — no updated_at column on ws_offline_enquiry).
 */
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
