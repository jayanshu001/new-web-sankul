import type { PopupNotifications } from "@prisma/client";
import type { PopupCreateInput, PopupDto, PopupUpdateInput } from "./popup.types";

export const toPopupDto = (row: PopupNotifications): PopupDto => ({
  _id: String(row.id),
  title: row.title,
  description: row.description,
  image: row.image,
  discount: row.discount,
  promocode: row.promocode,
  promoExpireAt: row.promo_expire_at ?? null,
  status: row.status,
  createdAt: row.created_at ?? undefined,
  updatedAt: row.updated_at ?? undefined,
});

export const toPrismaPopupCreate = (input: PopupCreateInput) => ({
  title: input.title,
  description: input.description,
  image: input.image,
  discount: input.discount ?? "",
  promocode: input.promocode ?? "",
  promo_expire_at: new Date(input.promoExpireAt),
  status: input.status ?? true,
  created_at: new Date(),
  updated_at: new Date(),
});

export const toPrismaPopupUpdate = (input: PopupUpdateInput) => ({
  ...(input.title !== undefined ? { title: input.title } : {}),
  ...(input.description !== undefined ? { description: input.description } : {}),
  ...(input.image !== undefined ? { image: input.image } : {}),
  ...(input.discount !== undefined ? { discount: input.discount } : {}),
  ...(input.promocode !== undefined ? { promocode: input.promocode } : {}),
  ...(input.promoExpireAt !== undefined
    ? { promo_expire_at: new Date(input.promoExpireAt) }
    : {}),
  ...(input.status !== undefined ? { status: input.status } : {}),
  updated_at: new Date(),
});
