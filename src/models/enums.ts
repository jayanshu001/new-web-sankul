// ─── Shared Enums ────────────────────────────────────────────────────────────
// Mirrors the Prisma enum definitions from websankul-api-staging

export const UpdateType = {
  IMMEDIATE: "immediate",
  FLEXIBLE: "flexible",
} as const;
export type UpdateType = (typeof UpdateType)[keyof typeof UpdateType];

export const BookLanguage = {
  ENGLISH: "English",
  GUJARATI: "Gujarati",
  HINDI: "Hindi",
} as const;
export type BookLanguage = (typeof BookLanguage)[keyof typeof BookLanguage];

export const BookOrderType = {
  PURCHASE: "purchase",
} as const;
export type BookOrderType = (typeof BookOrderType)[keyof typeof BookOrderType];

export const ExamType = {
  DAILY: "daily",
  SUBJECT: "subject",
} as const;
export type ExamType = (typeof ExamType)[keyof typeof ExamType];

export const ExamResultType = {
  TRUE: "true",
  FALSE: "false",
  SKIP: "skip",
} as const;
export type ExamResultType = (typeof ExamResultType)[keyof typeof ExamResultType];

export const PaymentMethod = {
  BACKEND: "Backend",
  RAZORPAY: "razorpay",
  BANK: "bank",
  CASH: "cash",
  FREE: "free",
  PAYKUN: "Paykun",
  PAYTM: "Paytm",
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const EBookLanguage = {
  ENGLISH: "English",
  GUJARATI: "Gujarati",
  HINDI: "Hindi",
} as const;
export type EBookLanguage = (typeof EBookLanguage)[keyof typeof EBookLanguage];

export const VideoType = {
  FREE: "free",
  PAID: "paid",
} as const;
export type VideoType = (typeof VideoType)[keyof typeof VideoType];

export const PackageCourseEbookOrderType = {
  PURCHASE: "purchase",
} as const;
export type PackageCourseEbookOrderType =
  (typeof PackageCourseEbookOrderType)[keyof typeof PackageCourseEbookOrderType];

export const PackageCourseEbookOrderStatus = {
  CANCEL: "cancel",
  COMPLETE: "complete",
  PENDING: "pending",
} as const;
export type PackageCourseEbookOrderStatus =
  (typeof PackageCourseEbookOrderStatus)[keyof typeof PackageCourseEbookOrderStatus];

export const PackageCourseEbookPaymentType = {
  BACKEND: "backend",
  ONLINE: "online",
} as const;
export type PackageCourseEbookPaymentType =
  (typeof PackageCourseEbookPaymentType)[keyof typeof PackageCourseEbookPaymentType];

export const PromocodeType = {
  PRIVATE: "private",
  PUBLIC: "public",
} as const;
export type PromocodeType = (typeof PromocodeType)[keyof typeof PromocodeType];

export const RefferalTransactionType = {
  CREDIT: "credit",
  DEBIT: "debit",
} as const;
export type RefferalTransactionType =
  (typeof RefferalTransactionType)[keyof typeof RefferalTransactionType];

export const RefferalTransactionStatus = {
  PENDING: "pending",
  SUCCESSFUL: "successful",
} as const;
export type RefferalTransactionStatus =
  (typeof RefferalTransactionStatus)[keyof typeof RefferalTransactionStatus];

export const OsType = {
  ANDROID: "android",
  IOS: "ios",
} as const;
export type OsType = (typeof OsType)[keyof typeof OsType];

export const InquiryCourse = {
  UPSC: "UPSC",
  GPSC: "GPSC",
  STI: "STI",
  DYSO: "DYSO",
  RFO: "RFO",
  PI: "PI",
  PSI: "PSI",
  CONSTABLE: "Constable",
  CCE: "CCE",
  TALATI: "Talati",
  FOREST: "Forest",
  TET_TAT: "TET_TAT",
  FHW_MPHW: "FHW_MPHW",
} as const;
export type InquiryCourse = (typeof InquiryCourse)[keyof typeof InquiryCourse];

export const InquiryMode = {
  ONLINE: "online",
  OFFLINE: "offline",
} as const;
export type InquiryMode = (typeof InquiryMode)[keyof typeof InquiryMode];

export const AdminRole = {
  SUPER_ADMIN: "super_admin",
  ADMIN: "admin",
  EDITOR: "editor",
} as const;
export type AdminRole = (typeof AdminRole)[keyof typeof AdminRole];

export const CRM_LEAD_TYPE = {
  VIEW_COURSE: "VIEW_COURSE",
} as const;
export type CRM_LEAD_TYPE = (typeof CRM_LEAD_TYPE)[keyof typeof CRM_LEAD_TYPE];
