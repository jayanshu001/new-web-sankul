/**
 * Client wishlist: per-customer saved items across course/package/ebook/book. `(customer_id,item_type,item_id)`
 * is UNIQUE, so add is idempotent. The populated `item` is a compact `{_id,title,thumbnail}` DTO.
 */
import { prisma } from "../../config/prisma";
import { matchesAllTokens } from "../../utils/searchFilter";

export const parseWlId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export type WlType = "course" | "package" | "ebook" | "book";
const WL_TYPES: WlType[] = ["course", "package", "ebook", "book"];
export const isWlType = (t: string): t is WlType => (WL_TYPES as string[]).includes(t);

const itemDto = (id: number, title: string | null, thumbnail: string | null) => ({
  _id: String(id), title, thumbnail,
});

/** Existence only; active/status is deliberately not enforced. */
export const itemExists = async (type: WlType, id: number): Promise<boolean> => {
  if (type === "course") return !!(await prisma.course.findFirst({ where: { id }, select: { id: true } }));
  if (type === "package") return !!(await prisma.package.findFirst({ where: { id }, select: { id: true } }));
  if (type === "ebook") return !!(await prisma.eBook.findFirst({ where: { id }, select: { id: true } }));
  return !!(await prisma.book.findFirst({ where: { id }, select: { id: true } }));
};

export const listWishlistMysql = async (
  customerId: number,
  itemType: WlType | null,
  opts: { search?: string; skip: number; limit: number },
) => {
  const where: any = { customerId };
  if (itemType) where.itemType = itemType;
  const entries = await prisma.wishlist.findMany({ where, orderBy: { createdAt: "desc" } });

  const idsByType: Record<WlType, number[]> = { course: [], package: [], ebook: [], book: [] };
  for (const e of entries) if (isWlType(e.itemType)) idsByType[e.itemType].push(e.itemId);

  const [courses, packages, ebooks, books] = await Promise.all([
    idsByType.course.length ? prisma.course.findMany({ where: { id: { in: idsByType.course } }, select: { id: true, name: true, image: true } }) : [],
    idsByType.package.length ? prisma.package.findMany({ where: { id: { in: idsByType.package } }, select: { id: true, name: true, image: true } }) : [],
    idsByType.ebook.length ? prisma.eBook.findMany({ where: { id: { in: idsByType.ebook } }, select: { id: true, name: true, thumbnail: true } }) : [],
    idsByType.book.length ? prisma.book.findMany({ where: { id: { in: idsByType.book } }, select: { id: true, name: true, thumbnail: true, image: true } }) : [],
  ]);

  const cMap = new Map(courses.map((c) => [c.id, itemDto(c.id, c.name ?? null, c.image ?? null)]));
  const pMap = new Map(packages.map((p) => [p.id, itemDto(p.id, p.name ?? null, p.image ?? null)]));
  const eMap = new Map(ebooks.map((e) => [e.id, itemDto(e.id, e.name ?? null, e.thumbnail ?? null)]));
  const bMap = new Map(books.map((b) => [b.id, itemDto(b.id, b.name ?? null, b.thumbnail ?? b.image ?? null)]));
  const mapFor: Record<WlType, Map<number, ReturnType<typeof itemDto>>> = { course: cMap, package: pMap, ebook: eMap, book: bMap };

  // Paginate over the combined createdAt-desc list, then re-group the window so the
  // `{courses,packages,ebooks,books}` response shape stays identical.
  let combined = entries
    .filter((e) => isWlType(e.itemType) && mapFor[e.itemType as WlType].has(e.itemId))
    .map((e) => ({
      _id: String(e.id),
      customerId: String(e.customerId),
      itemType: e.itemType,
      itemId: String(e.itemId),
      createdAt: e.createdAt ?? null,
      item: mapFor[e.itemType as WlType].get(e.itemId)!,
    }));

  if (opts.search) {
    combined = combined.filter((c) => matchesAllTokens(opts.search, [c.item.title]));
  }

  const total = combined.length;
  const window = combined.slice(opts.skip, opts.skip + opts.limit);
  const group = (type: WlType) => window.filter((w) => w.itemType === type);

  const data = {
    courses: group("course"),
    packages: group("package"),
    ebooks: group("ebook"),
    books: group("book"),
  };
  const count = window.length;
  return { data, count, total };
};

export const addWishlistMysql = async (customerId: number, itemType: WlType, itemId: number): Promise<"created" | "exists"> => {
  const existing = await prisma.wishlist.findFirst({ where: { customerId, itemType, itemId }, select: { id: true } });
  if (existing) return "exists";
  const now = new Date();
  try {
    await prisma.wishlist.create({ data: { customerId, itemType, itemId, createdAt: now, updatedAt: now } });
    return "created";
  } catch (err: any) {
    // Unique-constraint race: treat as already present.
    if (err?.code === "P2002") return "exists";
    throw err;
  }
};

export const removeWishlistMysql = async (customerId: number, itemType: WlType, itemId: number): Promise<boolean> => {
  const r = await prisma.wishlist.deleteMany({ where: { customerId, itemType, itemId } });
  return r.count > 0;
};

export const checkWishlistMysql = async (customerId: number, itemType: WlType, itemId: number): Promise<boolean> =>
  !!(await prisma.wishlist.findFirst({ where: { customerId, itemType, itemId }, select: { id: true } }));
