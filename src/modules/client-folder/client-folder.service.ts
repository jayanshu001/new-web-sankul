// Client folders: per-customer video/material save folders and their items.
import { prisma } from "../../config/prisma";
import { getPurchasedMaterialIds, materialMediaToken } from "../client-material/client-material.service";
import { buildPrismaSearch } from "../../utils/searchFilter";
import { parsePositiveInt } from "../../utils/parseId";
import type { Prisma } from "@prisma/client";

/** refId is a content id: video → ws_video, material → ws_material. */

export const parseFolderId = parsePositiveInt;

const DEFAULT_NAME: Record<string, string> = { video: "My Videos", material: "My Materials" };

/** Idempotent: ensure the two default folders exist for a customer. */
export const ensureDefaultFolders = async (customerId: number): Promise<void> => {
  for (const type of ["video", "material"] as const) {
    const existing = await prisma.folder.findFirst({ where: { customerId, type, isDefaultFolder: true }, select: { id: true } });
    if (!existing) {
      // Tolerate the unique (customer,type,name) index on a race.
      try { await prisma.folder.create({ data: { customerId, type, name: DEFAULT_NAME[type], isDefaultFolder: true, createdAt: new Date(), updatedAt: new Date() } }); }
      catch { /* already created concurrently */ }
    }
  }
};

const folderDto = (f: any, itemCount?: number) => ({
  _id: String(f.id), customerId: String(f.customerId), name: f.name, type: f.type,
  isDefaultFolder: !!f.isDefaultFolder, createdAt: f.createdAt ?? null, updatedAt: f.updatedAt ?? null,
  ...(itemCount !== undefined ? { itemCount } : {}),
});

const hydrateRefs = async (kind: string, refIds: number[], customerId: number | null = null): Promise<Map<number, any>> => {
  if (!refIds.length) return new Map();
  if (kind === "video") {
    const rows = await prisma.video.findMany({ where: { id: { in: refIds } } });
    return new Map(rows.map((v) => [v.id, { _id: String(v.id), title: v.title, topic: v.topic, slug: v.slug, platform: v.platform, status: v.status }]));
  }
  const rows = await prisma.material.findMany({ where: { id: { in: refIds } } });
  // Saved materials expose a mediaToken (resolved at /client/media/resolve), never the raw
  // file/direct_link. Paid materials are ownership-gated like the material list endpoints.
  const ownedIds = await getPurchasedMaterialIds(
    customerId,
    rows.map((m) => ({ _id: m.id, materialCategoryId: m.materialCategoryId as number, isPaid: !!m.isPaid })),
  );
  return new Map(rows.map((m) => {
    const isPaid = !!m.isPaid;
    const isPurchased = !isPaid || ownedIds.has(m.id);
    return [m.id, {
      _id: String(m.id), title: m.name, status: m.status,
      file: "", direct_link: null,
      isDirectLink: !m.file && !!m.direct_link,
      isPaid, isPurchased,
      mediaToken: materialMediaToken(m.id, isPurchased, isPaid, customerId),
    }];
  }));
};

export const listFolders = async (customerId: number, type: string, search: string | undefined, skip: number, take: number) => {
  await ensureDefaultFolders(customerId);
  const where: any = { customerId, type, ...(buildPrismaSearch(search, ["name"]) ?? {}) };
  const [folders, total] = await Promise.all([
    prisma.folder.findMany({ where, orderBy: [{ isDefaultFolder: "desc" }, { createdAt: "desc" }], skip, take }),
    prisma.folder.count({ where }),
  ]);
  const counts = await prisma.folderItem.groupBy({ by: ["folderId"], where: { customerId, kind: kindOf(type) }, _count: { _all: true } });
  const byFolder = new Map(counts.map((c) => [c.folderId, c._count._all]));
  return { data: folders.map((f) => folderDto(f, byFolder.get(f.id) ?? 0)), total };
};

const kindOf = (type: string) => (type === "video" ? "video" : "material");

export const createFolder = async (customerId: number, type: string, name: string): Promise<{ ok: true; data: any } | { ok: false; dup: true }> => {
  try {
    const f = await prisma.folder.create({ data: { customerId, type, name, isDefaultFolder: false, createdAt: new Date(), updatedAt: new Date() } });
    return { ok: true, data: folderDto(f) };
  } catch (e: any) {
    if (String(e?.code) === "P2002") return { ok: false, dup: true };
    throw e;
  }
};

export const folderDetail = async (customerId: number, type: string, folderId: number, skip: number, take: number) => {
  const folder = await prisma.folder.findFirst({ where: { id: folderId, customerId, type } });
  if (!folder) return null;
  const where = { folderId, customerId, kind: kindOf(type) };
  const [items, total] = await Promise.all([
    prisma.folderItem.findMany({ where, orderBy: { addedAt: "desc" }, skip, take }),
    prisma.folderItem.count({ where }),
  ]);
  const refMap = await hydrateRefs(kindOf(type), items.map((i) => i.refId), customerId);
  const list = items.map((it) => ({ _id: String(it.id), kind: it.kind, refId: String(it.refId), addedAt: it.addedAt, ref: refMap.get(it.refId) ?? null }));
  return { folder: folderDto(folder), list, total };
};

export const updateFolder = async (customerId: number, type: string, folderId: number, name: string): Promise<"not_found" | "dup" | any> => {
  const folder = await prisma.folder.findFirst({ where: { id: folderId, customerId, type }, select: { id: true } });
  if (!folder) return "not_found";
  try {
    const updated = await prisma.folder.update({ where: { id: folderId }, data: { name, updatedAt: new Date() } });
    return folderDto(updated);
  } catch (e: any) {
    if (String(e?.code) === "P2002") return "dup";
    throw e;
  }
};

// Empties the folder; a default folder itself is kept, only its items go.
export const removeFolder = async (customerId: number, type: string, folderId: number): Promise<{ ok: false } | { ok: true; wasDefault: boolean }> => {
  const existing = await prisma.folder.findFirst({ where: { id: folderId, customerId, type }, select: { id: true, isDefaultFolder: true } });
  if (!existing) return { ok: false };
  await prisma.$transaction(async (tx) => {
    await tx.folderItem.deleteMany({ where: { folderId, customerId } });
    if (!existing.isDefaultFolder) await tx.folder.deleteMany({ where: { id: folderId, customerId, type } });
  });
  return { ok: true, wasDefault: existing.isDefaultFolder };
};

// Save content into a folder (deduped; a repeat add returns the existing item).
export const addItem = async (customerId: number, type: string, folderId: number, refId: number): Promise<"folder_not_found" | "ref_not_found" | { deduped: boolean; data: any }> => {
  const kind = kindOf(type);
  const folder = await prisma.folder.findFirst({ where: { id: folderId, customerId, type }, select: { id: true } });
  if (!folder) return "folder_not_found";
  const refExists = kind === "video"
    ? await prisma.video.findFirst({ where: { id: refId }, select: { id: true } })
    : await prisma.material.findFirst({ where: { id: refId }, select: { id: true } });
  if (!refExists) return "ref_not_found";
  const existing = await prisma.folderItem.findFirst({ where: { folderId, kind, refId } });
  if (existing) return { deduped: true, data: { _id: String(existing.id), kind, refId: String(refId) } };
  try {
    const item = await prisma.folderItem.create({ data: { folderId, customerId, kind, refId, addedAt: new Date() } });
    return { deduped: false, data: { _id: String(item.id), kind, refId: String(refId), addedAt: item.addedAt } };
  } catch (e: any) {
    if (String(e?.code) === "P2002") {
      const dup = await prisma.folderItem.findFirst({ where: { folderId, kind, refId } });
      return { deduped: true, data: dup ? { _id: String(dup.id), kind, refId: String(refId) } : null };
    }
    throw e;
  }
};

export const removeItem = async (customerId: number, type: string, folderId: number, itemId: number): Promise<boolean> => {
  const folder = await prisma.folder.findFirst({ where: { id: folderId, customerId, type }, select: { id: true } });
  if (!folder) return false;
  const r = await prisma.folderItem.deleteMany({ where: { id: itemId, folderId, customerId, kind: kindOf(type) } });
  return r.count > 0;
};

// Paged folders with their items inlined; items whose content is gone are dropped.
export const allItems = async (customerId: number, type: string, search?: string, skip = 0, take = 20) => {
  await ensureDefaultFolders(customerId);
  const where: Prisma.FolderWhereInput = { customerId, type, ...(buildPrismaSearch(search, ["name"]) ?? {}) };
  const [folders, total] = await Promise.all([
    prisma.folder.findMany({ where, orderBy: [{ isDefaultFolder: "desc" }, { createdAt: "desc" }], skip, take }),
    prisma.folder.count({ where }),
  ]);
  if (!folders.length) return { data: [], total };
  const items = await prisma.folderItem.findMany({ where: { folderId: { in: folders.map((f) => f.id) }, customerId, kind: kindOf(type) }, orderBy: { addedAt: "desc" } });
  const refMap = await hydrateRefs(kindOf(type), items.map((i) => i.refId), customerId);
  const byFolder = new Map<number, any[]>();
  for (const it of items) {
    const ref = refMap.get(it.refId);
    if (!ref) continue; // only items whose content still exists
    const row = { _id: String(it.id), kind: it.kind, refId: String(it.refId), addedAt: it.addedAt, ref };
    (byFolder.get(it.folderId) ?? byFolder.set(it.folderId, []).get(it.folderId)!).push(row);
  }
  return { data: folders.map((f) => ({ folder: folderDto(f), list: byFolder.get(f.id) ?? [] })), total };
};

/** Profile-dashboard: count saved items of a kind whose content still exists. */
export const countSavedItems = async (customerId: number, kind: string): Promise<number> => {
  const items = await prisma.folderItem.findMany({ where: { customerId, kind }, select: { refId: true } });
  if (!items.length) return 0;
  const refMap = await hydrateRefs(kind, [...new Set(items.map((i) => i.refId))]);
  return items.reduce((n, i) => (refMap.has(i.refId) ? n + 1 : n), 0);
};
