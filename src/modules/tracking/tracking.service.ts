/**
 * Tracking / ActivityLog admin reads — MySQL (Prisma) branch. Wave 8.
 *
 * Gated behind `isMysqlModule("tracking")`. Net-new table `ws_activity_log`.
 * Two admin reads: paginated list + a summary (byEvent / dailyCount / total /
 * uniqueUsers). DTO mirrors the Mongo doc shape (`_id` string).
 */
import { isMysqlModule } from "../../config/migration";
import { prisma } from "../../config/prisma";

export const TRACKING_MODULE = "tracking";
export const isTrackingMysql = (): boolean => isMysqlModule(TRACKING_MODULE);

export const parseTrackingId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const dto = (r: any) => ({
  _id: String(r.id),
  customerId: r.customerId != null ? String(r.customerId) : null,
  event: r.event,
  entityType: r.entityType ?? null,
  entityId: r.entityId != null ? String(r.entityId) : null,
  duration: r.duration ?? null,
  metadata: r.metadata ?? {},
  ip: r.ip ?? null,
  userAgent: r.userAgent ?? null,
  createdAt: r.createdAt ?? null,
  updatedAt: r.updatedAt ?? null,
});

const buildWhere = (f: { customerId?: number; event?: string; entityType?: string; entityId?: number; from?: Date; to?: Date }) => {
  const where: any = {};
  if (f.customerId != null) where.customerId = f.customerId;
  if (f.event) where.event = f.event;
  if (f.entityType) where.entityType = f.entityType;
  if (f.entityId != null) where.entityId = f.entityId;
  if (f.from || f.to) {
    where.createdAt = {};
    if (f.from) where.createdAt.gte = f.from;
    if (f.to) where.createdAt.lte = f.to;
  }
  return where;
};

export const listActivity = async (opts: {
  customerId?: number; event?: string; entityType?: string; entityId?: number;
  from?: Date; to?: Date; page: number; limit: number;
}): Promise<{ data: any[]; total: number }> => {
  const where = buildWhere(opts);
  const skip = (opts.page - 1) * opts.limit;
  const [rows, total] = await Promise.all([
    prisma.activityLog.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: opts.limit }),
    prisma.activityLog.count({ where }),
  ]);
  return { data: rows.map(dto), total };
};

export const activitySummary = async (opts: { from?: Date; to?: Date }): Promise<{
  totalEvents: number; uniqueUsers: number; byEvent: any[]; dailyCount: any[];
}> => {
  const where = buildWhere(opts);

  const [byEventRows, totalEvents, distinctUsers] = await Promise.all([
    prisma.activityLog.groupBy({
      by: ["event"],
      where,
      _count: { event: true },
      orderBy: { _count: { event: "desc" } },
      take: 20,
    }),
    prisma.activityLog.count({ where }),
    prisma.activityLog.findMany({
      where: { ...where, customerId: { not: null } },
      select: { customerId: true },
      distinct: ["customerId"],
    }),
  ]);

  // dailyCount: group by Y/M/D. Prisma groupBy can't do date-part grouping, so
  // raw SQL with the same date bounds (mirrors the Mongo $year/$month/$dayOfMonth).
  const conds: string[] = [];
  const params: any[] = [];
  if (opts.from) { conds.push("created_at >= ?"); params.push(opts.from); }
  if (opts.to) { conds.push("created_at <= ?"); params.push(opts.to); }
  const whereSql = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const dailyRaw = await prisma.$queryRawUnsafe<any[]>(
    `SELECT YEAR(created_at) y, MONTH(created_at) m, DAY(created_at) d, COUNT(*) c
     FROM ws_activity_log ${whereSql}
     GROUP BY y, m, d ORDER BY y DESC, m DESC, d DESC LIMIT 30`,
    ...params
  );

  return {
    totalEvents,
    uniqueUsers: distinctUsers.length,
    byEvent: byEventRows.map((r) => ({ _id: r.event, count: r._count.event })),
    dailyCount: dailyRaw.map((r) => ({
      _id: { year: Number(r.y), month: Number(r.m), day: Number(r.d) },
      count: Number(r.c),
    })),
  };
};
