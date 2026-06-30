/**
 * Client test-series READ paths — SQL (Prisma) branch.
 *
 * Gated behind `isMysqlModule("client-testseries")`. Covers the two read
 * endpoints whose data lives entirely in already-migrated tables:
 *   GET /client/test-series                     (listTestSeries)
 *   GET /client/test-series/my/subscriptions    (listMySubscriptions)
 *
 * NOT covered (stay Mongo until net-new tables land): getTestSeriesDetail
 * (needs ws_test_series_content_category) and listSeriesPapers (needs
 * ws_test_series_content_category + ws_test_series_exam). The controller keeps
 * its Mongo branch for those two.
 *
 * Response contract is held identical to the Mongo path by `toListDto` /
 * `toSubscriptionDto`. `_id` is the SQL int stringified (matches every other
 * migrated module). Drift notes inline.
 */
import { prisma } from "../../config/prisma";
import { computeDaysLeft } from "../../utils/planDuration";

export const CLIENT_TESTSERIES_MODULE = "client-testseries";
export const isClientTestSeriesMysql = (): boolean => true;

export const parseCtsId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const num = (v: any): number => (v == null ? 0 : Number(v.toString?.() ?? v) || 0);

/**
 * Resolve the `examCategoryIds` JSON array (stored on ws_test_series) into the
 * populated `[{ _id, name }]` shape the Mongo `.populate("examCategoryIds")`
 * returns. The JSON holds SQL int ids; any id with no matching ExamCategory row
 * is dropped (mirrors Mongo populate, which silently omits dangling refs).
 */
const buildExamCategoryMap = async (
  rawIdLists: any[]
): Promise<Map<number, { _id: string; name: string | null }>> => {
  const ids = new Set<number>();
  for (const raw of rawIdLists) {
    if (Array.isArray(raw)) {
      for (const v of raw) {
        const n = Number(v);
        if (Number.isInteger(n) && n > 0) ids.add(n);
      }
    }
  }
  if (!ids.size) return new Map();
  const cats = await prisma.examCategory.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, name: true },
  });
  return new Map(cats.map((c) => [c.id, { _id: String(c.id), name: c.name ?? null }]));
};

const populateExamCategories = (
  raw: any,
  catMap: Map<number, { _id: string; name: string | null }>
): { _id: string; name: string | null }[] => {
  if (!Array.isArray(raw)) return [];
  const out: { _id: string; name: string | null }[] = [];
  for (const v of raw) {
    const n = Number(v);
    const hit = Number.isInteger(n) ? catMap.get(n) : undefined;
    if (hit) out.push(hit);
  }
  return out;
};

// ── listTestSeries ────────────────────────────────────────────────────────────

export type ListOpts = {
  search: string | null;
  page: number;
  limit: number;
  customerId: number | null;
  now: Date;
  base: string;
  buildShareUrl: (kind: string, id: string, base: string) => string;
};

export const listTestSeriesMysql = async (opts: ListOpts) => {
  const where: any = { status: true };
  if (opts.search) where.title = { contains: opts.search };

  const [rows, total] = await Promise.all([
    prisma.testSeries.findMany({
      where,
      orderBy: [{ orderBy: "asc" }, { createdAt: "desc" }],
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
      select: {
        id: true, title: true, description: true, thumbnail: true,
        examCategoryIds: true, language: true, paperCount: true, isFree: true, orderBy: true,
      },
    }),
    prisma.testSeries.count({ where }),
  ]);

  const seriesIds = rows.map((r) => r.id);

  // Default-price preview: sort isDefault desc, price asc; first per series wins.
  const defaultByid = new Map<number, any>();
  if (seriesIds.length) {
    const defaults = await prisma.testSeriesPrice.findMany({
      where: { testSeriesId: { in: seriesIds }, status: true },
      orderBy: [{ isDefault: "desc" }, { price: "asc" }],
    });
    for (const p of defaults) {
      if (!defaultByid.has(p.testSeriesId)) defaultByid.set(p.testSeriesId, p);
    }
  }

  // Latest-expiring active sub per series → daysLeft.
  const latestEndAtByid = new Map<number, Date>();
  if (opts.customerId && seriesIds.length) {
    const subs = await prisma.testSeriesSubscription.findMany({
      where: { customerId: opts.customerId, testSeriesId: { in: seriesIds }, status: true, endAt: { gt: opts.now } },
      select: { testSeriesId: true, endAt: true },
    });
    for (const s of subs) {
      if (!s.endAt) continue;
      const prev = latestEndAtByid.get(s.testSeriesId);
      if (!prev || s.endAt.getTime() > prev.getTime()) latestEndAtByid.set(s.testSeriesId, s.endAt);
    }
  }

  const catMap = await buildExamCategoryMap(rows.map((r) => r.examCategoryIds));

  const data = rows.map((r) => {
    const def = defaultByid.get(r.id);
    const defOriginal = def?.originalPrice != null ? num(def.originalPrice) : null;
    const defPrice = def ? num(def.price) : 0;
    const discountPct =
      defOriginal && defOriginal > defPrice
        ? Math.round(((defOriginal - defPrice) / defOriginal) * 100)
        : 0;
    const endAt = latestEndAtByid.get(r.id) ?? null;
    return {
      _id: String(r.id),
      title: r.title,
      description: r.description ?? null,
      thumbnail: r.thumbnail ?? null,
      examCategoryIds: populateExamCategories(r.examCategoryIds, catMap),
      language: r.language,
      paperCount: r.paperCount,
      isFree: r.isFree,
      orderBy: r.orderBy,
      isPaid: !r.isFree,
      defaultPlan: def
        ? { _id: String(def.id), durationDays: def.durationDays, price: defPrice, originalPrice: defOriginal, discountPct }
        : null,
      isPurchased: !!endAt,
      daysLeft: endAt ? computeDaysLeft(endAt, opts.now) : null,
      shareableLink: opts.buildShareUrl("test-series", String(r.id), opts.base),
    };
  });

  return { data, total };
};

// ── getTestSeriesDetail (needs net-new ws_test_series_content_category) ────────

export type DetailOpts = {
  id: number;
  customerId: number | null;
  now: Date;
  base: string;
  buildShareUrl: (kind: string, id: string, base: string) => string;
};

/** Returns null when the series is missing/inactive (→ controller 404). */
export const getTestSeriesDetailMysql = async (opts: DetailOpts) => {
  const series = await prisma.testSeries.findFirst({
    where: { id: opts.id, status: true },
    select: {
      id: true, title: true, description: true, thumbnail: true, examCategoryIds: true,
      language: true, paperCount: true, isFree: true, instructions: true, policy: true, orderBy: true,
      createdAt: true, updatedAt: true,
    },
  });
  if (!series) return null;

  const [contentCategories, prices] = await Promise.all([
    prisma.testSeriesContentCategory.findMany({
      where: { testSeriesId: opts.id, status: true },
      orderBy: [{ orderBy: "asc" }, { name: "asc" }],
    }),
    prisma.testSeriesPrice.findMany({
      where: { testSeriesId: opts.id, status: true },
      orderBy: [{ isDefault: "desc" }, { price: "asc" }],
    }),
  ]);

  let activeSubscription: any = null;
  if (opts.customerId) {
    const sub = await prisma.testSeriesSubscription.findFirst({
      where: { customerId: opts.customerId, testSeriesId: opts.id, status: true, endAt: { gt: opts.now } },
      orderBy: { endAt: "desc" },
    });
    if (sub) {
      activeSubscription = {
        _id: String(sub.id),
        customerId: String(sub.customerId),
        testSeriesId: String(sub.testSeriesId),
        planId: sub.planId != null ? String(sub.planId) : null,
        price: num(sub.price),
        startAt: sub.startAt ?? null,
        endAt: sub.endAt ?? null,
        paymentType: sub.paymentType,
        status: sub.status,
      };
    }
  }

  const catMap = await buildExamCategoryMap([series.examCategoryIds]);
  const shareableLink = opts.buildShareUrl("test-series", String(series.id), opts.base);
  const isPaid = !series.isFree;

  const seriesOut = {
    _id: String(series.id),
    title: series.title,
    description: series.description ?? null,
    thumbnail: series.thumbnail ?? null,
    examCategoryIds: populateExamCategories(series.examCategoryIds, catMap),
    language: series.language,
    paperCount: series.paperCount,
    isFree: series.isFree,
    instructions: series.instructions ?? null,
    policy: series.policy ?? null,
    orderBy: series.orderBy,
    createdAt: series.createdAt ?? null,
    updatedAt: series.updatedAt ?? null,
    isPaid,
    shareableLink,
  };

  return {
    series: seriesOut,
    contentCategories: contentCategories.map((c) => ({
      _id: String(c.id),
      testSeriesId: String(c.testSeriesId),
      name: c.name,
      icon: c.icon ?? null,
      orderBy: c.orderBy,
      status: c.status,
      createdAt: c.createdAt ?? null,
      updatedAt: c.updatedAt ?? null,
    })),
    prices: prices.map((p) => ({
      _id: String(p.id),
      testSeriesId: String(p.testSeriesId),
      name: p.name ?? null,
      durationDays: p.durationDays,
      price: num(p.price),
      originalPrice: p.originalPrice != null ? num(p.originalPrice) : null,
      isDefault: p.isDefault,
      status: p.status,
      isMostPopular: (p as any).isMostPopular ?? false,
    })),
    isPaid,
    isPurchased: !!activeSubscription,
    activeSubscription,
    daysLeft: activeSubscription ? computeDaysLeft(activeSubscription.endAt) : null,
    shareableLink,
  };
};

// ── listSeriesPapers (needs net-new ws_test_series_exam + ws_test_series_content_category) ──

export type SeriesPapersOpts = {
  id: number;
  customerId: number | null;
  now: Date;
};

/** Returns null when the series is missing/inactive (→ controller 404). */
export const listSeriesPapersMysql = async (opts: SeriesPapersOpts) => {
  const series = await prisma.testSeries.findFirst({
    where: { id: opts.id, status: true },
    select: { id: true, isFree: true },
  });
  if (!series) return null;

  const isPaid = !series.isFree;

  // Access — series-level subscription gates the "start" buttons.
  let hasAccess = false;
  if (series.isFree) {
    hasAccess = true;
  } else if (opts.customerId) {
    hasAccess = !!(await prisma.testSeriesSubscription.findFirst({
      where: { customerId: opts.customerId, testSeriesId: opts.id, status: true, endAt: { gt: opts.now } },
      select: { id: true },
    }));
  }

  const links = await prisma.testSeriesExam.findMany({
    where: { testSeriesId: opts.id, status: true },
    orderBy: [{ orderBy: "asc" }, { id: "asc" }],
  });

  // Exam DTO map keyed by exam id (parity with Mongo populate select).
  const examIds = [...new Set(links.map((l) => l.examId).filter((v): v is number => v != null))];
  const examMap = new Map<number, any>();
  if (examIds.length) {
    const exams = await prisma.exam.findMany({
      where: { id: { in: examIds } },
    });
    for (const e of exams) {
      examMap.set(e.id, {
        _id: String(e.id),
        title: e.name,
        isPaid: e.isPaid,
        durationMinutes: e.time,
        questionCount: e.numberOfQuestions,
        positiveMarks: num(e.positiveMarks),
        negativeMarks: num(e.negativeMarks),
        language: null,
        difficulty: null,
        status: e.status,
      });
    }
  }

  // Customer's most-recent attempt per exam.
  const resultByExam = new Map<number, any>();
  if (opts.customerId && examIds.length) {
    const results = await prisma.examResult.findMany({
      where: { customerId: opts.customerId, examId: { in: examIds }, status: true },
      orderBy: { created_at: "desc" },
    });
    for (const r of results) {
      if (r.examId == null || resultByExam.has(r.examId)) continue;
      resultByExam.set(r.examId, {
        _id: String(r.id),
        examId: String(r.examId),
        score: num(r.score),
        total: r.total,
        success: r.success,
        failed: r.failed,
        skip: r.skip,
        attempt: r.attempt,
        attemptNumber: r.attempt,
        timing: r.timing,
        updatedAt: r.created_at ?? null,
      });
    }
  }

  const categories = await prisma.testSeriesContentCategory.findMany({
    where: { testSeriesId: opts.id, status: true },
    orderBy: [{ orderBy: "asc" }, { name: "asc" }],
  });

  const grouped = categories.map((cat) => {
    const papers = links
      .filter((l) => l.contentCategoryId === cat.id)
      .map((l) => {
        const exam = l.examId != null ? examMap.get(l.examId) ?? null : null;
        const prev = exam && l.examId != null ? resultByExam.get(l.examId) ?? null : null;
        const paperIsPaid = !!exam?.isPaid;
        return {
          linkId: String(l.id),
          exam,
          orderBy: l.orderBy,
          isPaid: paperIsPaid,
          isLocked: paperIsPaid && !hasAccess,
          attemptState: prev ? "retake" : "start",
          lastResult: prev ?? null,
        };
      });
    return {
      _id: String(cat.id),
      name: cat.name,
      icon: cat.icon ?? null,
      orderBy: cat.orderBy,
      papers,
    };
  });

  return { isPaid, hasAccess, categories: grouped };
};

// ── listMySubscriptions ───────────────────────────────────────────────────────

export type MySubsOpts = {
  customerId: number;
  now: Date;
  base: string;
  buildShareUrl: (kind: string, id: string, base: string) => string;
};

export const listMySubscriptionsMysql = async (opts: MySubsOpts) => {
  const subs = await prisma.testSeriesSubscription.findMany({
    where: { customerId: opts.customerId, status: true },
    orderBy: { endAt: "desc" },
  });

  const seriesIds = [...new Set(subs.map((s) => s.testSeriesId))];
  const seriesById = new Map(
    (seriesIds.length
      ? await prisma.testSeries.findMany({
          where: { id: { in: seriesIds } },
          select: { id: true, title: true, thumbnail: true, paperCount: true },
        })
      : []
    ).map((t) => [t.id, t])
  );

  const data = subs.map((s) => {
    const endAt = s.endAt ?? null;
    const isActive = !!(endAt && endAt.getTime() > opts.now.getTime());
    const ts = s.testSeriesId ? seriesById.get(s.testSeriesId) : null;
    const testSeriesId = ts
      ? {
          _id: String(ts.id),
          title: ts.title,
          thumbnail: ts.thumbnail ?? null,
          paperCount: ts.paperCount,
          shareableLink: opts.buildShareUrl("test-series", String(ts.id), opts.base),
        }
      : null;
    return {
      _id: String(s.id),
      orderId: s.orderId != null ? String(s.orderId) : null,
      customerId: String(s.customerId),
      testSeriesId,
      planId: s.planId != null ? String(s.planId) : null,
      price: num(s.price),
      startAt: s.startAt ?? null,
      endAt,
      remarks: s.remarks ?? null,
      paymentType: s.paymentType,
      status: s.status,
      isActive,
      daysLeft: isActive ? computeDaysLeft(endAt, opts.now) : 0,
    };
  });

  return { data, total: data.length };
};
