import { prisma } from "../../config/prisma";
import { buildPrismaSearch } from "../../utils/searchFilter";
import type { PopupCreateInput, PopupUpdateInput } from "./popup.types";
import { toPrismaPopupCreate, toPrismaPopupUpdate } from "./popup.transformer";

export type PopupListOpts = {
  search?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  skip?: number;
  take?: number;
};

const POPUP_SORT_COLUMNS: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  title: "title",
  status: "status",
};

const buildPopupWhere = (opts: PopupListOpts): Record<string, unknown> =>
  buildPrismaSearch(opts.search, ["title", "description", "discount", "promocode"]) ?? {};

export const popupRepository = {
  /** Admin list — newest first (matches Mongo default createdAt desc). */
  findMany: () =>
    prisma.popupNotifications.findMany({ orderBy: { created_at: "desc" } }),

  /** Admin paginated + search list. */
  findPage: (opts: PopupListOpts) =>
    prisma.popupNotifications.findMany({
      where: buildPopupWhere(opts),
      orderBy: { [POPUP_SORT_COLUMNS[opts.sortBy ?? ""] ?? "created_at"]: opts.sortDir ?? "desc" },
      ...(opts.skip != null ? { skip: opts.skip } : {}),
      ...(opts.take != null ? { take: opts.take } : {}),
    }),

  count: (opts: PopupListOpts) =>
    prisma.popupNotifications.count({ where: buildPopupWhere(opts) }),

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
