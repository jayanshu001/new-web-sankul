/**
 * Terms & Conditions — stable API shape (Mongo-compatible for admin / client).
 *
 * Field names match 1:1 between Mongo and legacy MySQL; the divergences are:
 *  - collection/table name (`ws_terms_and_conditions` ↔ `ws_termsandcondition`),
 *    handled by Prisma `@@map`.
 *  - `module` is a fixed MySQL `enum('book','pendrive','referral code')` — the
 *    Prisma model types it loosely as `String`, but writes MUST use a legacy
 *    enum value or MySQL rejects the row (error 1265). Mirrors faq's `type` enum.
 *    NOTE: `pendrive` is retired (no longer a product) — it's excluded from the
 *    accepted API values below. The physical DB enum may still list it; we just
 *    never accept/offer it. `book` and `referral code` remain.
 */

/** Accepted `ws_termsandcondition.module` values (pendrive retired). */
export const TERMS_MODULES = ["book", "referral code"] as const;
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
