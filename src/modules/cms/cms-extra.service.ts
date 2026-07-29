/**
 * CMS extras — SocialLinkType / SocialLink / CurrentAffair / LiveBannerSlider
 * admin CRUD on MySQL (Prisma). Wave 8. Net-new tables ws_social_link(_type),
 * ws_current_affair, ws_live_banner_slider.
 *
 * Gated behind `isMysqlModule("cms-extra")`. DTOs mirror the Mongo doc shape
 * (`_id` string; SocialLink populates typeId→{_id,title}; LiveBanner exposes
 * liveCourseId as a string — full populate of the live course is NOT reproduced
 * here, the FE only needs the id for these admin lists).
 */
import { prisma } from "../../config/prisma";
import { buildPrismaSearch } from "../../utils/searchFilter";
import { nextOrder } from "../../utils/listOrdering";

export const CMS_EXTRA_MODULE = "cms-extra";
export const isCmsExtraMysql = (): boolean => true;

export const parseCmsId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

type Envelope<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

// ─── SocialLinkType ──────────────────────────────────────────────────────────
const sltDto = (r: any) => ({ _id: String(r.id), title: r.title, createdAt: r.createdAt ?? null, updatedAt: r.updatedAt ?? null });

export const listSocialLinkTypes = async () =>
  (await prisma.socialLinkType.findMany({ orderBy: { title: "asc" } })).map(sltDto);

// Client read: `?search=` (title) + pagination, ordered by title.
export const listSocialLinkTypesPaged = async (q: {
  search?: string; skip?: number; take?: number;
}) => {
  const where = buildPrismaSearch(q.search, ["title"]) ?? {};
  const [rows, total] = await Promise.all([
    prisma.socialLinkType.findMany({
      where,
      orderBy: { title: "asc" },
      ...(q.skip != null ? { skip: q.skip } : {}),
      ...(q.take != null ? { take: q.take } : {}),
    }),
    prisma.socialLinkType.count({ where }),
  ]);
  return { items: rows.map(sltDto), total };
};

export const getSocialLinkType = async (id: number) => {
  const r = await prisma.socialLinkType.findUnique({ where: { id } });
  return r ? sltDto(r) : null;
};

export const createSocialLinkType = async (input: { title: string }) => {
  const now = new Date();
  return sltDto(await prisma.socialLinkType.create({ data: { title: input.title, createdAt: now, updatedAt: now } }));
};

export const updateSocialLinkType = async (id: number, input: { title?: string }) => {
  const exists = await prisma.socialLinkType.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return null;
  return sltDto(await prisma.socialLinkType.update({ where: { id }, data: { ...input, updatedAt: new Date() } }));
};

export const deleteSocialLinkType = async (id: number): Promise<Envelope<null>> => {
  const exists = await prisma.socialLinkType.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return { ok: false, status: 404, message: "Not found." };
  const inUse = await prisma.socialLink.findFirst({ where: { typeId: id }, select: { id: true } });
  if (inUse) return { ok: false, status: 409, message: "Social Link Type is in use by one or more links and cannot be deleted." };
  await prisma.socialLinkType.delete({ where: { id } });
  return { ok: true, data: null };
};

// ─── SocialLink ──────────────────────────────────────────────────────────────
const slDto = (r: any) => ({
  _id: String(r.id),
  typeId: r.type ? { _id: String(r.type.id), title: r.type.title } : String(r.typeId),
  title: r.title, icon: r.icon ?? null, link: r.link, order: r.orderBy, status: r.status,
  createdAt: r.createdAt ?? null, updatedAt: r.updatedAt ?? null,
});

// SocialLink has no Prisma relation to SocialLinkType (scalar typeId), so we
// hydrate the type manually to mirror the Mongo .populate("typeId","_id title").
const hydrateTypes = async (rows: any[]) => {
  const typeIds = [...new Set(rows.map((r) => r.typeId))];
  const types = typeIds.length
    ? await prisma.socialLinkType.findMany({ where: { id: { in: typeIds } }, select: { id: true, title: true } })
    : [];
  const byId = new Map(types.map((t) => [t.id, t]));
  return rows.map((r) => ({ ...r, type: byId.get(r.typeId) ?? null }));
};

// Admin read: recency is the contract (utils/listOrdering). The client readers
// below still sort by `orderBy`.
export const listSocialLinks = async () => {
  const rows = await prisma.socialLink.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  return (await hydrateTypes(rows)).map(slDto);
};

// Client read: active links only, `order_by ASC, created_at ASC`.
export const listClientSocialLinks = async () => {
  const rows = await prisma.socialLink.findMany({
    where: { status: true },
    orderBy: [{ orderBy: "asc" }, { createdAt: "asc" }],
  });
  return (await hydrateTypes(rows)).map(slDto);
};

// Client read (paged): active links only, ordered by orderBy, with `?search=`
// (title/link) + pagination. Mirrors listClientSocialLinks + count over the
// identical where.
export const listClientSocialLinksPaged = async (q: {
  search?: string; skip?: number; take?: number;
}) => {
  const where: any = { status: true };
  const search = buildPrismaSearch(q.search, ["title", "link"]);
  if (search) where.AND = search.AND;
  const [rows, total] = await Promise.all([
    prisma.socialLink.findMany({
      where,
      orderBy: [{ orderBy: "asc" }, { createdAt: "asc" }],
      ...(q.skip != null ? { skip: q.skip } : {}),
      ...(q.take != null ? { take: q.take } : {}),
    }),
    prisma.socialLink.count({ where }),
  ]);
  return { items: (await hydrateTypes(rows)).map(slDto), total };
};

export const getSocialLink = async (id: number) => {
  const r = await prisma.socialLink.findUnique({ where: { id } });
  if (!r) return null;
  const [h] = await hydrateTypes([r]);
  return slDto(h);
};

export const createSocialLink = async (input: {
  typeId: number; title: string; icon?: string; link: string; order?: number; status?: boolean;
}) => {
  const now = new Date();
  // No explicit order → previous row + 1 (see utils/listOrdering).
  const orderBy = input.order ?? nextOrder((await prisma.socialLink.findFirst({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { orderBy: true } }))?.orderBy);
  const r = await prisma.socialLink.create({
    data: {
      typeId: input.typeId, title: input.title, icon: input.icon ?? null, link: input.link,
      orderBy, status: input.status ?? true, createdAt: now, updatedAt: now,
    },
  });
  const [h] = await hydrateTypes([r]);
  return slDto(h);
};

export const updateSocialLink = async (id: number, input: {
  typeId?: number; title?: string; icon?: string; link?: string; order?: number; status?: boolean;
}) => {
  const exists = await prisma.socialLink.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return null;
  const data: any = {};
  if (input.typeId !== undefined) data.typeId = input.typeId;
  if (input.title !== undefined) data.title = input.title;
  if (input.icon !== undefined) data.icon = input.icon;
  if (input.link !== undefined) data.link = input.link;
  if (input.order !== undefined) data.orderBy = input.order;
  if (input.status !== undefined) data.status = input.status;
  data.updatedAt = new Date();
  const r = await prisma.socialLink.update({ where: { id }, data });
  const [h] = await hydrateTypes([r]);
  return slDto(h);
};

export const deleteSocialLink = async (id: number): Promise<boolean> => {
  const exists = await prisma.socialLink.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return false;
  await prisma.socialLink.delete({ where: { id } });
  return true;
};

// ─── CurrentAffair ───────────────────────────────────────────────────────────
const caDto = (r: any) => ({
  _id: String(r.id), title: r.title, image: r.image, youtubeLink: r.youtubeLink, status: r.status,
  createdAt: r.createdAt ?? null, updatedAt: r.updatedAt ?? null,
});

export const listCurrentAffairs = async () =>
  (await prisma.currentAffair.findMany({ orderBy: { createdAt: "desc" } })).map(caDto);

const CA_SORT_COLUMNS: Record<string, string> = { createdAt: "createdAt", title: "title", status: "status" };

/**
 * Admin search + sort + opt-in pagination. `skip`/`take` apply only when
 * provided (absent → full filtered list). Always returns the total count.
 */
export const listCurrentAffairsPaged = async (q: {
  search?: string; sortBy?: string; sortDir?: "asc" | "desc"; skip?: number; take?: number;
}) => {
  const where = buildPrismaSearch(q.search, ["title", "youtubeLink", "image"]) ?? {};
  const [rows, total] = await Promise.all([
    prisma.currentAffair.findMany({
      where,
      orderBy: { [CA_SORT_COLUMNS[q.sortBy ?? ""] ?? "createdAt"]: q.sortDir ?? "desc" },
      ...(q.skip != null ? { skip: q.skip } : {}),
      ...(q.take != null ? { take: q.take } : {}),
    }),
    prisma.currentAffair.count({ where }),
  ]);
  return { items: rows.map(caDto), total };
};

// Client read: active affairs, newest first, only the fields the client
// renders (image, title, youtubeLink). `limit` (>0) caps the list. Mirrors the
// Mongo CurrentAffair.find({status:true}).sort({createdAt:-1}).select(...).
export const listClientCurrentAffairs = async (limit = 0) => {
  const rows = await prisma.currentAffair.findMany({
    where: { status: true },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, image: true, youtubeLink: true },
    ...(limit > 0 ? { take: limit } : {}),
  });
  return rows.map((r) => ({ _id: String(r.id), title: r.title, image: r.image, youtubeLink: r.youtubeLink }));
};

// Client read (paged): active affairs, newest first, only the fields the client
// renders, with `?search=` (title) + pagination. Mirrors listClientCurrentAffairs
// + count over the identical where.
export const listClientCurrentAffairsPaged = async (q: {
  search?: string; skip?: number; take?: number;
}) => {
  const where: any = { status: true };
  const search = buildPrismaSearch(q.search, ["title"]);
  if (search) where.AND = search.AND;
  const [rows, total] = await Promise.all([
    prisma.currentAffair.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, image: true, youtubeLink: true },
      ...(q.skip != null ? { skip: q.skip } : {}),
      ...(q.take != null ? { take: q.take } : {}),
    }),
    prisma.currentAffair.count({ where }),
  ]);
  return {
    items: rows.map((r) => ({ _id: String(r.id), title: r.title, image: r.image, youtubeLink: r.youtubeLink })),
    total,
  };
};

export const getCurrentAffair = async (id: number) => {
  const r = await prisma.currentAffair.findUnique({ where: { id } });
  return r ? caDto(r) : null;
};

export const createCurrentAffair = async (input: { title: string; image: string; youtubeLink: string; status?: boolean }) => {
  const now = new Date();
  return caDto(await prisma.currentAffair.create({
    data: { title: input.title, image: input.image, youtubeLink: input.youtubeLink, status: input.status ?? true, createdAt: now, updatedAt: now },
  }));
};

export const updateCurrentAffair = async (id: number, input: { title?: string; image?: string; youtubeLink?: string; status?: boolean }) => {
  const exists = await prisma.currentAffair.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return null;
  return caDto(await prisma.currentAffair.update({ where: { id }, data: { ...input, updatedAt: new Date() } }));
};

export const deleteCurrentAffair = async (id: number): Promise<boolean> => {
  const exists = await prisma.currentAffair.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return false;
  await prisma.currentAffair.delete({ where: { id } });
  return true;
};

// ─── LiveBannerSlider ────────────────────────────────────────────────────────
const lbDto = (r: any) => ({
  _id: String(r.id), image: r.image, liveCourseId: String(r.liveCourseId), orderBy: r.orderBy,
  createdAt: r.createdAt ?? null, updatedAt: r.updatedAt ?? null,
});

// Admin read: recency is the contract (utils/listOrdering).
export const listLiveBanners = async () =>
  (await prisma.liveBannerSlider.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] })).map(lbDto);

const LB_SORT_COLUMNS: Record<string, string> = { orderBy: "orderBy", createdAt: "createdAt" };

/**
 * Admin search + sort + opt-in pagination. `skip`/`take` apply only when
 * provided (absent → full filtered list). Always returns the total count.
 */
export const listLiveBannersPaged = async (q: {
  search?: string; sortBy?: string; sortDir?: "asc" | "desc"; skip?: number; take?: number;
}) => {
  const where = buildPrismaSearch(q.search, ["image"]) ?? {};
  const [rows, total] = await Promise.all([
    prisma.liveBannerSlider.findMany({
      where,
      // "orderBy" / no sort → recency; any other column sorts as requested.
      orderBy:
        LB_SORT_COLUMNS[q.sortBy ?? ""] === "createdAt"
          ? [{ createdAt: q.sortDir ?? "asc" }, { id: "desc" as const }]
          : [{ createdAt: "desc" as const }, { id: "desc" as const }],
      ...(q.skip != null ? { skip: q.skip } : {}),
      ...(q.take != null ? { take: q.take } : {}),
    }),
    prisma.liveBannerSlider.count({ where }),
  ]);
  return { items: rows.map(lbDto), total };
};

// Client read (paged): ordered by orderBy. Live-banner rows are image +
// liveCourseId only (no natural text field) → pagination ONLY, no `search`.
export const listLiveBannersClientPaged = async (q: {
  skip?: number; take?: number;
}) => {
  const where = {};
  const [rows, total] = await Promise.all([
    prisma.liveBannerSlider.findMany({
      where,
      orderBy: [{ orderBy: "asc" }, { createdAt: "asc" }],
      ...(q.skip != null ? { skip: q.skip } : {}),
      ...(q.take != null ? { take: q.take } : {}),
    }),
    prisma.liveBannerSlider.count({ where }),
  ]);
  return { items: rows.map(lbDto), total };
};

export const getLiveBanner = async (id: number) => {
  const r = await prisma.liveBannerSlider.findUnique({ where: { id } });
  return r ? lbDto(r) : null;
};

export const createLiveBanner = async (input: { image: string; liveCourseId: number; orderBy?: number }) => {
  const now = new Date();
  // No explicit orderBy → previous row + 1 (utils/listOrdering), matching
  // POST /admin/cms/banners so both banner lists behave identically. Single
  // list, so the lookup is global.
  const orderBy =
    input.orderBy ??
    nextOrder((await prisma.liveBannerSlider.findFirst({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { orderBy: true } }))?.orderBy);
  return lbDto(await prisma.liveBannerSlider.create({
    data: { image: input.image, liveCourseId: input.liveCourseId, orderBy, createdAt: now, updatedAt: now },
  }));
};

export const updateLiveBanner = async (id: number, input: { image?: string; liveCourseId?: number; orderBy?: number }) => {
  const exists = await prisma.liveBannerSlider.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return null;
  return lbDto(await prisma.liveBannerSlider.update({ where: { id }, data: { ...input, updatedAt: new Date() } }));
};

export const deleteLiveBanner = async (id: number): Promise<boolean> => {
  const exists = await prisma.liveBannerSlider.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return false;
  await prisma.liveBannerSlider.delete({ where: { id } });
  return true;
};

/** Reorder: apply [{id, orderBy}] updates. Returns count applied. */
export const reorderLiveBanners = async (orders: { id: string; orderBy: number }[]): Promise<number> => {
  let count = 0;
  for (const o of orders) {
    const nid = parseCmsId(o.id);
    if (nid == null) continue;
    const r = await prisma.liveBannerSlider.updateMany({ where: { id: nid }, data: { orderBy: o.orderBy, updatedAt: new Date() } });
    count += r.count;
  }
  return count;
};
