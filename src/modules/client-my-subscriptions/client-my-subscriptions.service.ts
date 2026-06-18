import { isMysqlModule } from "../../config/migration";
import { clientMySubscriptionsRepository as repo } from "./client-my-subscriptions.repository";

export const MY_SUBSCRIPTIONS_MODULE = "client-my-subscriptions";
export const isMySubscriptionsMysql = (): boolean => isMysqlModule(MY_SUBSCRIPTIONS_MODULE);

export const parseMySubId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const daysLeftOf = (endAt: Date | null, now: Date) =>
  endAt ? Math.max(0, Math.ceil((endAt.getTime() - now.getTime()) / MS_PER_DAY)) : null;

const idStr = (v: number | null | undefined): string | null => (v != null && v > 0 ? String(v) : null);
const emptyAction = { courseId: null as any, packageId: null as any, planId: null as any, testSeriesId: null as any, ebookId: null as any };

// ── course + package cards (dedup to furthest endAt per target, soonest-first) ──
export const buildCourseAndPackageCards = async (customerId: number, now: Date) => {
  const all = await repo.activeCourseSubs(customerId, now); // already endAt desc
  const seen = new Set<string>();
  const deduped = all.filter((s) => {
    // key by target: course → c:<id>, else package (package_id) → p:<id>, else row.
    const key = s.courseId && s.courseId > 0 ? `c:${s.courseId}` : s.packageId && s.packageId > 0 ? `p:${s.packageId}` : `s:${s.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const subs = deduped.sort((a, b) => (a.endAt?.getTime() ?? 0) - (b.endAt?.getTime() ?? 0));
  if (!subs.length) return [];

  const courses = new Map((await repo.coursesByIds([...new Set(subs.map((s) => s.courseId).filter((x): x is number => x != null && x > 0))])).map((c) => [c.id, c]));
  const packages = new Map((await repo.packagesByIds([...new Set(subs.map((s) => s.packageId).filter((x): x is number => x != null && x > 0))])).map((p) => [p.id, p]));
  const plans = new Map((await repo.plansByIds([...new Set(subs.map((s) => s.planId).filter((x): x is number => x != null && x > 0))])).map((p) => [p.id, p]));
  const types = new Map((await repo.packageTypesByIds([...new Set([...packages.values()].map((p) => p.packageTypeId).filter((x): x is number => x != null && x > 0))])).map((t) => [t.id, t]));

  return subs.map((s) => {
    const course = s.courseId ? courses.get(s.courseId) : null;
    const pkg = s.packageId ? packages.get(s.packageId) : null;
    const type = pkg?.packageTypeId ? types.get(pkg.packageTypeId) : null;
    const plan = s.planId ? plans.get(s.planId) : null;
    return {
      _id: String(s.id),
      title: course?.name || pkg?.name || "Subscription",
      author: null, // ws_course has no author column (Mongo-only)
      thumbnail: course?.image || pkg?.image || null,
      badge: type?.name || null,
      daysLeft: daysLeftOf(s.endAt ?? null, now),
      startAt: s.startAt ?? null,
      endAt: s.endAt ?? null,
      action: { ...emptyAction, kind: s.courseId && s.courseId > 0 ? "course" : "package", courseId: idStr(s.courseId), packageId: idStr(s.packageId), planId: idStr(s.planId) },
      meta: { duration: plan?.duration ?? null, packageName: pkg?.name ?? null },
    };
  });
};

// ── ebook cards (dedup per ebookId, soonest-first) ─────────────────────────────
export const buildEbookCards = async (customerId: number, now: Date) => {
  const all = await repo.activeEbookSubs(customerId, now);
  const seen = new Set<string>();
  const deduped = all.filter((s) => {
    const key = `e:${s.ebookId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const subs = deduped.sort((a, b) => (a.endAt?.getTime() ?? 0) - (b.endAt?.getTime() ?? 0));
  if (!subs.length) return [];

  const ebooks = new Map((await repo.ebooksByIds([...new Set(subs.map((s) => s.ebookId).filter((x): x is number => x != null && x > 0))])).map((e) => [e.id, e]));
  return subs.map((s) => {
    const eb = s.ebookId ? ebooks.get(s.ebookId) : null;
    return {
      _id: String(s.id),
      title: eb?.name || "eBook",
      author: eb?.author || null,
      thumbnail: eb?.thumbnail || eb?.image || null,
      badge: "eBook",
      daysLeft: daysLeftOf(s.endAt ?? null, now),
      startAt: s.startAt ?? null,
      endAt: s.endAt ?? null,
      action: { ...emptyAction, kind: "ebook", ebookId: idStr(s.ebookId) },
      meta: {},
    };
  });
};
