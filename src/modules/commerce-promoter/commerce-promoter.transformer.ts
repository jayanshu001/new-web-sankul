import type { Promoter } from "@prisma/client";
import type { PromoterDto } from "./commerce-promoter.types";

/**
 * `ws_promoter` row → DTO, shape-compatible with the Mongo `Promoter` document
 * (camelCase). `password` is DELIBERATELY excluded — the Mongo model marks it
 * `select:false` and it must never reach a client response. `is_delete` →
 * `isDelete`; `full_name` → `fullName`.
 */
export const toPromoterDto = (row: Promoter): PromoterDto => ({
  _id: String(row.id),
  fullName: row.full_name ?? null,
  email: row.email ?? null,
  phone: row.phone ?? null,
  image: row.image ?? null,
  status: row.status,
  isDelete: row.is_delete,
  createdAt: row.created_at ?? null,
  updatedAt: row.updated_at ?? null,
});
