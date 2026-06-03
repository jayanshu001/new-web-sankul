/** Legacy MySQL FAQ categories (enum on `ws_faq.type`). */
export const FAQ_TYPES = ["general", "referral"] as const;
export type FaqCategory = (typeof FAQ_TYPES)[number];

/** Stable API shape (Mongo-compatible for admin / client). */
export interface FaqTypeDto {
  _id: string;
  title: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface FaqDto {
  _id: string;
  /** Synthetic populated shape when served from MySQL. */
  typeId: FaqTypeDto | string;
  type?: FaqCategory;
  question: string;
  answer: string;
  isExpand?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

/** MySQL create/update payload. */
export interface FaqCreateInput {
  type: FaqCategory;
  question: string;
  answer: string;
  isExpand?: boolean;
}

/** Mongo create payload (separate `ws_faq_types` collection). */
export interface FaqCreateMongoInput {
  typeId: string;
  question: string;
  answer: string;
}

export interface FaqUpdateInput {
  type?: FaqCategory;
  question?: string;
  answer?: string;
  isExpand?: boolean;
}

export interface FaqUpdateMongoInput {
  typeId?: string;
  question?: string;
  answer?: string;
}

export const FAQ_TYPE_LABELS: Record<FaqCategory, string> = {
  general: "General",
  referral: "Referral",
};
