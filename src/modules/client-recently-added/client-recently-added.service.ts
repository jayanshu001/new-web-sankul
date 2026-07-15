import { clientRecentlyAddedRepository as repo } from "./client-recently-added.repository";
import { computeDaysLeft } from "../../utils/planDuration";
import {
  toCourseDto,
  plansGrouped,
  getDaysLeftMap,
  getOwnedCourseIds,
} from "../admin-live-course/admin-live-course.service";

export const CLIENT_RECENTLY_ADDED_MODULE = "client-recently-added";

export const parseCustomerId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// The three kinds surfaced by the feed. Planner/Smart are package types (via
// ws_package.package_type_id); live-course is ws_live_course.
export type RecentKind = "planner" | "smart" | "live-course";
const ALL_KINDS: RecentKind[] = ["planner", "smart", "live-course"];

export const parseKinds = (raw?: string | string[] | null): RecentKind[] => {
  if (raw == null) return [...ALL_KINDS];
  const list = (Array.isArray(raw) ? raw : String(raw).split(","))
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is RecentKind => (ALL_KINDS as string[]).includes(s));
  // Unknown/empty → default to all kinds (never an empty feed from a bad param).
  return list.length ? [...new Set(list)] : [...ALL_KINDS];
};

// Resolve the Planner/Smart package-type ids by NAME from ws_package_type (the same
// source as GET /admin/packages/types) — e.g. "Planner Course" → planner, "Smart
// Course" → smart. Name-matched (case-insensitive substring) so it survives id
// changes and needs no env/config. Multiple matching types per kind are supported.
const resolveKindTypeIds = async (): Promise<{ planner: number[]; smart: number[] }> => {
  const types = await repo.allPackageTypes();
  const planner: number[] = [];
  const smart: number[] = [];
  for (const t of types) {
    const name = (t.name ?? "").toLowerCase();
    if (name.includes("planner")) planner.push(t.id);
    else if (name.includes("smart")) smart.push(t.id);
  }
  return { planner, smart };
};

const packageCard = (p: any, kind: RecentKind, plans: { withMaterial: any[]; withoutMaterial: any[] }, own?: { isPurchased: boolean; daysLeft: number | null }) => ({
  _id: String(p.id),
  kind,
  type: "package" as const,
  title: p.name,
  name: p.name,
  image: p.image ?? null,
  packageType: p.packageType ? { _id: String(p.packageType.id), name: p.packageType.name } : null,
  plans,
  isPaid: true,
  isPurchased: own?.isPurchased ?? false,
  daysLeft: own?.daysLeft ?? null,
  createdAt: p.created_at ?? null,
});

const liveCard = (row: any, plans: any[], isPurchased: boolean, daysLeft: number | null) => ({
  ...toCourseDto(row),
  kind: "live-course" as const,
  type: "live-course" as const,
  title: row.name,
  plans,
  isPurchased,
  daysLeft,
  createdAt: row.createdAt ?? null,
});

/**
 * Combined "Recently Added" feed across Planner packages, Smart packages, and
 * live courses — merged by created date desc, with server-side search + paging.
 *
 * Each source table has its own PK space, so we over-fetch each to (skip+take),
 * merge + sort, slice the page, THEN decorate only that page (plans + ownership).
 * `total` is the exact sum of per-kind counts for the active filter.
 */
export const listRecentlyAdded = async (
  customerId: number | null,
  opts: { kinds?: RecentKind[]; search?: string | null; page: number; limit: number }
) => {
  const search = opts.search?.trim() || null;
  const kinds = opts.kinds && opts.kinds.length ? opts.kinds : [...ALL_KINDS];
  const wantLive = kinds.includes("live-course");
  const wantPackages = kinds.includes("planner") || kinds.includes("smart");

  // Resolve Planner/Smart type ids by name; map each type id back to its kind so
  // fetched package rows can be tagged. Only queried when a package kind is wanted.
  const { planner, smart } = wantPackages ? await resolveKindTypeIds() : { planner: [], smart: [] };
  const typeIdToKind = new Map<number, RecentKind>();
  for (const id of planner) typeIdToKind.set(id, "planner");
  for (const id of smart) typeIdToKind.set(id, "smart");

  const typeIds: number[] = [];
  if (kinds.includes("planner")) typeIds.push(...planner);
  if (kinds.includes("smart")) typeIds.push(...smart);

  const skip = (opts.page - 1) * opts.limit;
  const over = skip + opts.limit; // enough head rows to fill this page after the merge.

  const [pkgRows, pkgCount, liveRows, liveCount] = await Promise.all([
    repo.recentPackagesByTypes(typeIds, search, over),
    repo.countPackagesByTypes(typeIds, search),
    wantLive ? repo.recentLiveCourses(search, over) : Promise.resolve([]),
    wantLive ? repo.countLiveCourses(search) : Promise.resolve(0),
  ]);

  // Merge raw rows tagged with kind + createdAt, newest first.
  type Raw = { kind: RecentKind; id: number; createdAt: Date | null; row: any };
  const raws: Raw[] = [];
  for (const p of pkgRows) {
    const kind = p.packageTypeId != null ? typeIdToKind.get(p.packageTypeId) ?? null : null;
    if (kind) raws.push({ kind, id: p.id, createdAt: p.created_at ?? null, row: p });
  }
  for (const c of liveRows as any[]) raws.push({ kind: "live-course", id: c.id, createdAt: c.createdAt ?? null, row: c });
  raws.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));

  const pageRaws = raws.slice(skip, skip + opts.limit);
  const total = pkgCount + liveCount;

  // Decorate only the sliced page.
  const pagePkgIds = pageRaws.filter((r) => r.kind !== "live-course").map((r) => r.id);
  const pageLiveIds = pageRaws.filter((r) => r.kind === "live-course").map((r) => r.id);
  const now = new Date();

  const [pkgPlans, pkgSubs, livePlans, liveDaysLeft, liveOwned] = await Promise.all([
    repo.packagePlansByPackageIds(pagePkgIds),
    customerId ? repo.packageSubsForOwnership(customerId, pagePkgIds, now) : Promise.resolve([]),
    pageLiveIds.length ? plansGrouped(pageLiveIds) : Promise.resolve(new Map<number, any[]>()),
    getDaysLeftMap(customerId, pageLiveIds),
    getOwnedCourseIds(customerId),
  ]);

  // Group package plans by material flag (same shape as the dashboard package card).
  const plansByPackage = new Map<number, { withMaterial: any[]; withoutMaterial: any[] }>();
  for (const p of pkgPlans) {
    if (p.packageId == null) continue;
    const b = plansByPackage.get(p.packageId) ?? plansByPackage.set(p.packageId, { withMaterial: [], withoutMaterial: [] }).get(p.packageId)!;
    (p.withMaterial ? b.withMaterial : b.withoutMaterial).push(p);
  }
  // Package ownership → { isPurchased, daysLeft } (lifetime/null wins, else max daysLeft).
  const pkgOwn = new Map<number, { isPurchased: boolean; daysLeft: number | null }>();
  for (const s of pkgSubs as { packageId: number | null; endAt: Date | null }[]) {
    if (s.packageId == null) continue;
    const dl = s.endAt == null ? null : computeDaysLeft(s.endAt, now);
    const prev = pkgOwn.get(s.packageId);
    if (!prev) { pkgOwn.set(s.packageId, { isPurchased: true, daysLeft: dl }); continue; }
    if (prev.daysLeft === null || dl === null) pkgOwn.set(s.packageId, { isPurchased: true, daysLeft: null });
    else if (dl > prev.daysLeft) pkgOwn.set(s.packageId, { isPurchased: true, daysLeft: dl });
  }

  const data = pageRaws.map((r) => {
    if (r.kind === "live-course") {
      const key = String(r.id);
      return liveCard(r.row, livePlans.get(r.id) ?? [], liveOwned.has(key), liveDaysLeft.has(key) ? liveDaysLeft.get(key) ?? null : null);
    }
    return packageCard(r.row, r.kind, plansByPackage.get(r.id) ?? { withMaterial: [], withoutMaterial: [] }, pkgOwn.get(r.id));
  });

  return { data, total, page: opts.page, limit: opts.limit };
};
