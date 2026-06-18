/**
 * Goal admin CRUD — MySQL (Prisma) branch. Wave 8. Net-new `ws_goal`.
 *
 * Gated behind `isMysqlModule("goal")`. The legacy `src/admin/goal/goal.admin.service.ts`
 * branches each function here (keeping its shared Redis cache + S3 cleanup). DTO
 * mirrors the Mongo doc shape (`_id` string; labels as [{ name }]). The Mongo
 * label `_id`s are dropped — SQL stores labels as a JSON [{ name }] array.
 */
import { isMysqlModule } from "../../config/migration";
import { prisma } from "../../config/prisma";

export const GOAL_MODULE = "goal";
export const isGoalMysql = (): boolean => isMysqlModule(GOAL_MODULE);

export const parseGoalId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const dto = (g: any) => ({
  _id: String(g.id),
  title: g.title,
  labels: Array.isArray(g.labels) ? g.labels : [],
  image: g.image ?? null,
  isActive: g.isActive,
  createdAt: g.createdAt ?? null,
  updatedAt: g.updatedAt ?? null,
});

export const createGoalSql = async (input: {
  title: string; labels: { name: string }[]; image?: string | null; isActive: boolean;
}) => {
  const now = new Date();
  const row = await prisma.goal.create({
    data: {
      title: input.title,
      labels: input.labels as any,
      image: input.image ?? null,
      isActive: input.isActive,
      createdAt: now,
      updatedAt: now,
    },
  });
  return dto(row);
};

export const getGoalsSql = async (q: {
  search?: string; isActive?: boolean; page: number; limit: number;
  sortBy: string; sortOrder: "asc" | "desc";
}): Promise<{ data: any[]; meta: { total: number; page: number; limit: number; totalPages: number } }> => {
  const where: any = {};
  if (q.search && q.search.trim()) where.title = { contains: q.search.trim() };
  if (q.isActive !== undefined) where.isActive = q.isActive;
  const allowed = new Set(["createdAt", "title", "updatedAt"]);
  const field = allowed.has(q.sortBy) ? q.sortBy : "createdAt";
  const skip = (q.page - 1) * q.limit;
  const [rows, total] = await Promise.all([
    prisma.goal.findMany({ where, orderBy: { [field]: q.sortOrder }, skip, take: q.limit }),
    prisma.goal.count({ where }),
  ]);
  return {
    data: rows.map(dto),
    meta: { total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) },
  };
};

/** Returns the row + its old image url (for S3 cleanup by the caller), or null. */
export const updateGoalSql = async (
  id: number,
  input: { title?: string; labels?: { name: string }[]; image?: string | null; isActive?: boolean }
): Promise<{ goal: any; previousImage: string | null } | null> => {
  const existing = await prisma.goal.findUnique({ where: { id } });
  if (!existing) return null;
  const data: any = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.labels !== undefined) data.labels = input.labels as any;
  let previousImage: string | null = null;
  if (input.image !== undefined) {
    const next = input.image === "" ? null : input.image;
    if (existing.image && existing.image !== next) previousImage = existing.image;
    data.image = next;
  }
  if (input.isActive !== undefined) data.isActive = input.isActive;
  data.updatedAt = new Date();
  const row = await prisma.goal.update({ where: { id }, data });
  return { goal: dto(row), previousImage };
};

/** Returns the deleted row's image url (for S3 cleanup), or undefined if missing. */
export const deleteGoalSql = async (id: number): Promise<{ image: string | null } | null> => {
  const existing = await prisma.goal.findUnique({ where: { id }, select: { image: true } });
  if (!existing) return null;
  await prisma.goal.delete({ where: { id } });
  return { image: existing.image ?? null };
};
