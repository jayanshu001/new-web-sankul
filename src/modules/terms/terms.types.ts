/**
 * Terms & Conditions — stable API shape (Mongo-compatible for admin / client).
 *
 * Field names match 1:1 between Mongo and legacy MySQL; the divergences are:
 *  - collection/table name (`ws_terms_and_conditions` ↔ `ws_termsandcondition`),
 *    handled by Prisma `@@map`.
 *  - `module` is a fixed MySQL `enum('book','pendrive','referral code')` — the
 *    Prisma model types it loosely as `String`, but writes MUST use a legacy
 *    enum value or MySQL rejects the row (error 1265). Mirrors faq's `type` enum.
 */

/** Legacy MySQL `ws_termsandcondition.module` enum values. */
export const TERMS_MODULES = ["book", "pendrive", "referral code"] as const;
export type TermsModule = (typeof TERMS_MODULES)[number];

export interface TermsDto {
  _id: string;
  module: string;
  terms: string;
  freeShippingMinimumOrderAmount: number;
  status: boolean;
}

export interface TermsCreateInput {
  module: string;
  terms: string;
  freeShippingMinimumOrderAmount?: number;
  status?: boolean;
}

export interface TermsUpdateInput {
  module?: string;
  terms?: string;
  freeShippingMinimumOrderAmount?: number;
  status?: boolean;
}
