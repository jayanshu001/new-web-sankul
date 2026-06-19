import { prisma } from "../../config/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Prisma persistence for the admin-live-course MySQL branch (Wave 6).
 *  - courses       → ws_live_course (schedule folders/entries live in JSON cols)
 *  - plans         → ws_live_course_plan
 *  - subscriptions → ws_live_course_subscription
 *  - sessions      → ws_live_session (+ ws_live_session_course join, liveCourseIds[])
 *
 * ⚠ STAY Mongo (no SQL branch): the folder/video-in-folder controllers + the
 * createLiveCourse Root-folder automation — ws_video_category has no
 * live_course_id column (same blocker as the Wave 5 course Root folder).
 * Schedule folders/entries are JSON on ws_live_course with synthetic string ids
 * minted by the service (the Mongo API addresses them by subdoc _id).
 * ⚠ plan.duration is treated as DAYS by the controllers (computeEndAt asDays).
 */
const courseInclude = undefined; // refs (educator/category) have no FK rows on staging; surfaced as ids

export const adminLiveCourseRepository = {
  // ── courses ───────────────────────────────────────────────────────────────
  list: (opts: { search?: string; status?: boolean; skip: number; take: number }) =>
    prisma.liveCourse.findMany({ where: buildWhere(opts), orderBy: [{ ordered: "asc" }, { createdAt: "desc" }], skip: opts.skip, take: opts.take }),
  count: (opts: { search?: string; status?: boolean }) => prisma.liveCourse.count({ where: buildWhere(opts) }),
  findById: (id: number) => prisma.liveCourse.findUnique({ where: { id } }),
  exists: (id: number) => prisma.liveCourse.findUnique({ where: { id }, select: { id: true } }),
  create: (data: Prisma.LiveCourseUncheckedCreateInput) => prisma.liveCourse.create({ data }),
  update: (id: number, data: Prisma.LiveCourseUncheckedUpdateInput) => prisma.liveCourse.update({ where: { id }, data }),
  delete: (id: number) =>
    prisma.$transaction(async (tx) => {
      await tx.liveCoursePlan.deleteMany({ where: { liveCourseId: id } });
      await tx.liveCourse.delete({ where: { id } });
    }),
  setSchedule: (id: number, field: "scheduleFolders", value: any) =>
    prisma.liveCourse.update({ where: { id }, data: { [field]: value, updatedAt: new Date() } as any }),

  // ── plans ────────────────────────────────────────────────────────────────────
  listPlans: (liveCourseId: number) =>
    prisma.liveCoursePlan.findMany({ where: { liveCourseId }, orderBy: [{ isDefault: "desc" }, { price: "asc" }, { id: "asc" }] }),
  findPlanById: (id: number) => prisma.liveCoursePlan.findUnique({ where: { id } }),
  createPlan: (data: Prisma.LiveCoursePlanUncheckedCreateInput) => prisma.liveCoursePlan.create({ data }),
  updatePlan: (id: number, data: Prisma.LiveCoursePlanUncheckedUpdateInput) => prisma.liveCoursePlan.update({ where: { id }, data }),
  deletePlan: (id: number) => prisma.liveCoursePlan.delete({ where: { id } }),
  clearDefaultPlans: (liveCourseId: number, exceptId?: number) =>
    prisma.liveCoursePlan.updateMany({ where: { liveCourseId, isDefault: true, ...(exceptId ? { id: { not: exceptId } } : {}) }, data: { isDefault: false } }),
  verifiedSubCountForPlan: (planId: number) => prisma.liveCourseSubscription.count({ where: { planId, paymentStatus: "verified" } }),

  // ── subscriptions ──────────────────────────────────────────────────────────
  listSubscriptions: (opts: { liveCourseId?: number; customerId?: number; planId?: number; paymentStatus?: string; status?: boolean; skip: number; take: number }) =>
    prisma.liveCourseSubscription.findMany({ where: buildSubWhere(opts), orderBy: { id: "desc" }, skip: opts.skip, take: opts.take }),
  countSubscriptions: (opts: { liveCourseId?: number; customerId?: number; planId?: number; paymentStatus?: string; status?: boolean }) =>
    prisma.liveCourseSubscription.count({ where: buildSubWhere(opts) }),
  findSubscriptionById: (id: number) => prisma.liveCourseSubscription.findUnique({ where: { id } }),
  createSubscription: (data: Prisma.LiveCourseSubscriptionUncheckedCreateInput) => prisma.liveCourseSubscription.create({ data }),
  updateSubscription: (id: number, data: Prisma.LiveCourseSubscriptionUncheckedUpdateInput) => prisma.liveCourseSubscription.update({ where: { id }, data }),
  deleteSubscription: (id: number) => prisma.liveCourseSubscription.delete({ where: { id } }),
  /** Existing active+verified subscription for grant-extend (latest endAt). */
  findActiveSubscription: (customerId: number, liveCourseId: number, now: Date) =>
    prisma.liveCourseSubscription.findFirst({
      where: { customerId, liveCourseId, status: true, paymentStatus: "verified", OR: [{ endAt: null }, { endAt: { gte: now } }] },
      orderBy: { endAt: "desc" },
    }),

  // ── customer hydration (subscription list/get) ───────────────────────────────
  customersByIds: (ids: number[]) =>
    ids.length ? prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, phoneNumber: true, emailAddress: true } }) : Promise.resolve([]),
  customerExists: (id: number) => prisma.customer.findUnique({ where: { id }, select: { id: true } }),
  coursesByIds: (ids: number[]) =>
    ids.length ? prisma.liveCourse.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, image: true } }) : Promise.resolve([]),
  plansByIds: (ids: number[]) =>
    ids.length ? prisma.liveCoursePlan.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, duration: true, price: true } }) : Promise.resolve([]),

  // ── sessions for a course (many-to-many join) ────────────────────────────────
  sessionsForCourse: async (liveCourseId: number, opts: { status?: string; upcoming?: boolean; now: Date; skip: number; take: number }) => {
    const links = await prisma.liveSessionCourse.findMany({ where: { liveCourseId }, select: { liveSessionId: true } });
    const ids = links.map((l) => l.liveSessionId);
    if (!ids.length) return { rows: [], total: 0 };
    const where: Prisma.LiveSessionWhereInput = { id: { in: ids } };
    if (opts.upcoming) { where.status = "SCHEDULED"; where.scheduledAt = { gte: opts.now }; }
    else if (opts.status) where.status = opts.status;
    const [rows, total] = await Promise.all([
      prisma.liveSession.findMany({ where, orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }], skip: opts.skip, take: opts.take }),
      prisma.liveSession.count({ where }),
    ]);
    return { rows, total };
  },

  // ── client course reads ──────────────────────────────────────────────────────
  /** Active courses (status:true) with optional name search + optional startTime-future + optional category. */
  listClientCourses: (opts: { search?: string; upcomingOnly?: boolean; packageCategoryId?: number; now: Date; sort: "ordered" | "startTime"; skip: number; take: number }) => {
    const where = clientCourseWhere(opts);
    return prisma.liveCourse.findMany({ where, orderBy: opts.sort === "startTime" ? [{ startTime: "asc" }, { ordered: "asc" }] : [{ ordered: "asc" }, { createdAt: "desc" }], skip: opts.skip, take: opts.take });
  },
  countClientCourses: (opts: { search?: string; upcomingOnly?: boolean; packageCategoryId?: number; now: Date }) =>
    prisma.liveCourse.count({ where: clientCourseWhere(opts) }),
  coursesByIdsActive: (ids: number[]) =>
    ids.length ? prisma.liveCourse.findMany({ where: { id: { in: ids }, status: true }, orderBy: [{ ordered: "asc" }, { createdAt: "desc" }] }) : Promise.resolve([]),
  activePlansForCourses: (ids: number[]) =>
    ids.length ? prisma.liveCoursePlan.findMany({ where: { liveCourseId: { in: ids }, status: true }, orderBy: { price: "asc" } }) : Promise.resolve([]),
  /** Per-category upcoming-batch counts (tab bar). */
  upcomingCategoryCounts: async (now: Date): Promise<Map<number, number>> => {
    const rows = await prisma.liveCourse.groupBy({ by: ["packageCategoryId"], where: { status: true, startTime: { gte: now }, packageCategoryId: { not: null } }, _count: { _all: true } });
    return new Map(rows.filter((r) => r.packageCategoryId != null).map((r) => [r.packageCategoryId as number, r._count._all]));
  },

  /** Cross-course session feeds. ids = the courses the customer can see. */
  sessionsForCourses: async (courseIds: number[], opts: { upcoming?: boolean; liveNow?: boolean; now: Date; skip: number; take: number }) => {
    if (!courseIds.length) return { rows: [], total: 0, courseBySession: new Map<number, number[]>() };
    const links = await prisma.liveSessionCourse.findMany({ where: { liveCourseId: { in: courseIds } }, select: { liveSessionId: true, liveCourseId: true } });
    const sessionIds = [...new Set(links.map((l) => l.liveSessionId))];
    if (!sessionIds.length) return { rows: [], total: 0, courseBySession: new Map<number, number[]>() };
    const courseBySession = new Map<number, number[]>();
    for (const l of links) { const a = courseBySession.get(l.liveSessionId) ?? []; a.push(l.liveCourseId); courseBySession.set(l.liveSessionId, a); }
    const where: Prisma.LiveSessionWhereInput = { id: { in: sessionIds } };
    if (opts.upcoming) { where.status = "SCHEDULED"; where.scheduledAt = { gte: opts.now }; }
    else if (opts.liveNow) where.status = "CREATED"; // "live now" = CREATED (mirrors Mongo)
    const [rows, total] = await Promise.all([
      prisma.liveSession.findMany({ where, orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }], skip: opts.skip, take: opts.take }),
      prisma.liveSession.count({ where }),
    ]);
    return { rows, total, courseBySession };
  },

  // ── entitlement (client reads) — all on migrated subscription/plan/course tables ──
  /** Active+verified subscriptions for a customer over a set of courses. */
  activeSubsForCourses: (customerId: number, liveCourseIds: number[], now: Date) =>
    liveCourseIds.length
      ? prisma.liveCourseSubscription.findMany({
          where: { customerId, liveCourseId: { in: liveCourseIds }, status: true, paymentStatus: "verified", OR: [{ endAt: null }, { endAt: { gte: now } }] },
          select: { liveCourseId: true, endAt: true },
        })
      : Promise.resolve([]),
  /** All a customer's active+verified course ids (for "my courses" / owned set). */
  ownedCourseIds: async (customerId: number, now: Date): Promise<number[]> => {
    const rows = await prisma.liveCourseSubscription.findMany({
      where: { customerId, status: true, paymentStatus: "verified", OR: [{ endAt: null }, { endAt: { gte: now } }] },
      select: { liveCourseId: true },
    });
    return [...new Set(rows.map((r) => r.liveCourseId))];
  },
  /** Verified-subscription count per course (popularity ranking). */
  purchaseCounts: async (liveCourseIds: number[]): Promise<Map<number, number>> => {
    if (!liveCourseIds.length) return new Map();
    const rows = await prisma.liveCourseSubscription.groupBy({ by: ["liveCourseId"], where: { liveCourseId: { in: liveCourseIds }, paymentStatus: "verified" }, _count: { _all: true } });
    return new Map(rows.map((r) => [r.liveCourseId, r._count._all]));
  },

  // ── reminders (ws_live_session_reminder) — READ only on SQL (writes provision Mongo notifications) ──
  remindersForCustomer: (customerId: number) =>
    prisma.liveSessionReminder.findMany({ where: { customerId }, orderBy: { id: "desc" } }),
  reminderForSession: (customerId: number, liveSessionId: number) =>
    prisma.liveSessionReminder.findFirst({ where: { customerId, liveSessionId } }),
  sessionsByIds: (ids: number[]) =>
    ids.length ? prisma.liveSession.findMany({ where: { id: { in: ids } } }) : Promise.resolve([]),

  // ── chat (ws_live_chat_message / ws_live_chat_ban) ──────────────────────────
  chatHistory: (liveClassId: string, limit: number, before?: Date) =>
    prisma.liveChatMessage.findMany({
      where: { liveClassId, deletedAt: null, ...(before ? { createdAt: { lt: before } } : {}) },
      orderBy: { createdAt: "desc" }, take: limit,
    }),
  chatBanForCustomer: (customerId: number) => prisma.liveChatBan.findFirst({ where: { customerId } }),
  listChatBans: () => prisma.liveChatBan.findMany({ orderBy: { id: "desc" } }),
  findChatMessage: (id: number) => prisma.liveChatMessage.findUnique({ where: { id } }),
  createChatMessage: (data: Prisma.LiveChatMessageUncheckedCreateInput) => prisma.liveChatMessage.create({ data }),
  softDeleteChatMessage: (id: number, deletedBy: number | null) =>
    prisma.liveChatMessage.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date(), deletedBy, updatedAt: new Date() } }),
  banCustomer: (liveClassId: string, customerId: number, bannedBy: number | null, reason: string | null) =>
    prisma.liveChatBan.create({ data: { liveClassId, customerId, bannedBy, reason, createdAt: new Date(), updatedAt: new Date() } }),
  unbanCustomer: (customerId: number) => prisma.liveChatBan.deleteMany({ where: { customerId } }),

  // ── polls (ws_live_poll / ws_live_poll_option / ws_live_poll_vote) ──────────
  activePoll: (liveClassId: string) => prisma.livePoll.findFirst({ where: { liveClassId, isActive: true } }),
  pollsByClass: (liveClassId: string) => prisma.livePoll.findMany({ where: { liveClassId }, orderBy: { id: "desc" } }),
  findPoll: (id: number) => prisma.livePoll.findUnique({ where: { id } }),
  pollOptions: (pollId: number) => prisma.livePollOption.findMany({ where: { pollId }, orderBy: { optionIndex: "asc" } }),
  pollVoteFor: (pollId: number, customerId: number) => prisma.livePollVote.findFirst({ where: { pollId, customerId } }),
  pollOptionAt: (pollId: number, optionIndex: number) => prisma.livePollOption.findFirst({ where: { pollId, optionIndex } }),
  /**
   * Record one vote atomically: insert the (pollId,customerId) vote row (the
   * @@unique uq_lpv guards double-voting), bump that option's votes and the
   * poll's totalVotes. The vote insert is FIRST so a duplicate throws (P2002)
   * before any counter moves — mirrors the Mongo unique-index 11000 behaviour.
   */
  recordPollVote: (pollId: number, customerId: number, optionIndex: number) =>
    prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.livePollVote.create({ data: { pollId, customerId, optionIndex, createdAt: now, updatedAt: now } });
      await tx.livePollOption.updateMany({ where: { pollId, optionIndex }, data: { votes: { increment: 1 } } });
      await tx.livePoll.update({ where: { id: pollId }, data: { totalVotes: { increment: 1 }, updatedAt: now } });
    }),
  createPollWithOptions: (poll: Prisma.LivePollUncheckedCreateInput, options: Array<{ text: string; votes: number }>) =>
    prisma.$transaction(async (tx) => {
      const created = await tx.livePoll.create({ data: poll });
      if (options.length) await tx.livePollOption.createMany({ data: options.map((o, i) => ({ pollId: created.id, optionIndex: i, text: o.text, votes: o.votes })) });
      return created;
    }),
  updatePoll: (id: number, data: Prisma.LivePollUncheckedUpdateInput) => prisma.livePoll.update({ where: { id }, data }),
  closePoll: (id: number) => prisma.livePoll.update({ where: { id }, data: { isActive: false, closedAt: new Date(), updatedAt: new Date() } }),
  deletePoll: (id: number) =>
    prisma.$transaction(async (tx) => {
      await tx.livePollOption.deleteMany({ where: { pollId: id } });
      await tx.livePollVote.deleteMany({ where: { pollId: id } });
      await tx.livePoll.delete({ where: { id } });
    }),
};

function buildWhere(opts: { search?: string; status?: boolean }): Prisma.LiveCourseWhereInput {
  const where: Prisma.LiveCourseWhereInput = {};
  if (opts.search) where.name = { contains: opts.search.trim() };
  if (opts.status !== undefined) where.status = opts.status;
  return where;
}

function clientCourseWhere(opts: { search?: string; upcomingOnly?: boolean; packageCategoryId?: number; now: Date }): Prisma.LiveCourseWhereInput {
  const where: Prisma.LiveCourseWhereInput = { status: true };
  if (opts.search) where.name = { contains: opts.search.trim() };
  if (opts.upcomingOnly) where.startTime = { gte: opts.now };
  if (opts.packageCategoryId !== undefined) where.packageCategoryId = opts.packageCategoryId;
  return where;
}

function buildSubWhere(opts: { liveCourseId?: number; customerId?: number; planId?: number; paymentStatus?: string; status?: boolean }): Prisma.LiveCourseSubscriptionWhereInput {
  const where: Prisma.LiveCourseSubscriptionWhereInput = {};
  if (opts.liveCourseId !== undefined) where.liveCourseId = opts.liveCourseId;
  if (opts.customerId !== undefined) where.customerId = opts.customerId;
  if (opts.planId !== undefined) where.planId = opts.planId;
  if (opts.paymentStatus) where.paymentStatus = opts.paymentStatus;
  if (opts.status !== undefined) where.status = opts.status;
  return where;
}

void courseInclude;
