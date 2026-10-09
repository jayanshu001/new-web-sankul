// FAQs: DTO, input types and the FAQ type enum.

/** Enum on `ws_faq.type`. */
export const FAQ_TYPES = ["general", "referral"] as const;
export type FaqCategory = (typeof FAQ_TYPES)[number];

export interface FaqTypeDto {
  _id: string;
  title: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface FaqDto {
  _id: string;
  typeId: FaqTypeDto | string;
  type?: FaqCategory;
  question: string;
  answer: string;
  isExpand?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface FaqCreateInput {
  type: FaqCategory;
  question: string;
  answer: string;
  isExpand?: boolean;
}

export interface FaqUpdateInput {
  type?: FaqCategory;
  question?: string;
  answer?: string;
  isExpand?: boolean;
}

export const FAQ_TYPE_LABELS: Record<FaqCategory, string> = {
  general: "General",
  referral: "Referral",
};
