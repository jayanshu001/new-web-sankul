// Terms and conditions: DTO and input types.
/**
 * `module` is a MySQL `enum('book','pendrive','referral code')`; Prisma types it as
 * `String`, but writes must use an enum value or MySQL rejects the row (error 1265).
 * `pendrive` is retired and never accepted, though the DB enum may still list it.
 */

import type { DepartmentContactDto } from "../department/department.types";

export const TERMS_MODULES = ["book", "referral code"] as const;
export type TermsModule = (typeof TERMS_MODULES)[number];

export interface TermsDto {
  _id: string;
  module: string;
  terms: string;
  freeShippingMinimumOrderAmount: number;
  status: boolean;
}

/**
 * Client read only: the module's helpline contacts from the department mapped in
 * `TERMS_HELPLINE_DEPARTMENT`, same row shape as `/client/contact-us`; `[]` when unmapped.
 */
export interface ClientTermsDto extends TermsDto {
  contacts: DepartmentContactDto[];
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
