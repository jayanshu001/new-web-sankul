import type { TermsAndConditions } from "@prisma/client";
import type { TermsCreateInput, TermsDto, TermsUpdateInput } from "./terms.types";

export const toTermsDto = (row: TermsAndConditions): TermsDto => ({
  _id: String(row.id),
  module: row.module,
  terms: row.terms,
  freeShippingMinimumOrderAmount: row.freeShippingMinimumOrderAmount,
  status: row.status,
});

export const toPrismaTermsCreate = (input: TermsCreateInput) => ({
  module: input.module,
  terms: input.terms,
  freeShippingMinimumOrderAmount: input.freeShippingMinimumOrderAmount ?? 0,
  status: input.status ?? true,
});

export const toPrismaTermsUpdate = (input: TermsUpdateInput) => ({
  ...(input.module !== undefined ? { module: input.module } : {}),
  ...(input.terms !== undefined ? { terms: input.terms } : {}),
  ...(input.freeShippingMinimumOrderAmount !== undefined
    ? { freeShippingMinimumOrderAmount: input.freeShippingMinimumOrderAmount }
    : {}),
  ...(input.status !== undefined ? { status: input.status } : {}),
});
