import { prisma } from "../../config/prisma";
import type { PopupCreateInput, PopupUpdateInput } from "./popup.types";
import { toPrismaPopupCreate, toPrismaPopupUpdate } from "./popup.transformer";

export const popupRepository = {
  /** Admin list — newest first (matches Mongo default createdAt desc). */
  findMany: () =>
    prisma.popupNotifications.findMany({ orderBy: { created_at: "desc" } }),

  findById: (id: number) =>
    prisma.popupNotifications.findUnique({ where: { id } }),

  /**
   * Client active popup: status:true AND promo_expire_at > now, newest first.
   * Returns the single most recent match (or null).
   */
  findActive: (now: Date) =>
    prisma.popupNotifications.findFirst({
      where: { status: true, promo_expire_at: { gt: now } },
      orderBy: { created_at: "desc" },
    }),

  create: (input: PopupCreateInput) =>
    prisma.popupNotifications.create({ data: toPrismaPopupCreate(input) }),

  update: (id: number, input: PopupUpdateInput) =>
    prisma.popupNotifications.update({
      where: { id },
      data: toPrismaPopupUpdate(input),
    }),

  delete: (id: number) => prisma.popupNotifications.delete({ where: { id } }),
};
