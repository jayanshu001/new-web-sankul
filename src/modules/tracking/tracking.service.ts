// Activity tracking: client event logging and admin activity reports.
import { prisma } from "../../config/prisma";

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

/**
 * POST /client/tracking. `customerId`/`entityId` are ints, null when absent or
 * non-numeric, matching how the admin reads treat entityId.
 */
export const createActivity = async (input: {
  customerId: number | null;
  event: string;
  entityType?: string | null;
  entityId?: number | null;
  duration?: number | null;
  metadata?: any;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> => {
  const now = new Date();
  await prisma.activityLog.create({
    data: {
      customerId: input.customerId,
      event: input.event,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      duration: input.duration ?? null,
      metadata: (input.metadata ?? {}) as any,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      createdAt: now,
      updatedAt: now,
    },
  });
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

// Totals, top 20 events and per-day counts for the last 30 active days.
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

  // Prisma groupBy can't group by date part, so raw SQL with the same date bounds.
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
