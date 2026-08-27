// Shared filter/normalization helpers for the admin "Reports" subscription
// endpoints (Course / Package / Live Course / Test Series). Centralised so all
// four apply an IDENTICAL date-range + status contract.
//
// Contract (see docs/REPORTS_SUBSCRIPTIONS_ADMIN.md):
//   status  = "active" | "expired" | "inactive"  (computed from status bool + endAt)
//     active   = status:true AND (endAt IS NULL OR endAt > now)
//     expired  = status:true AND endAt <= now
//     inactive = status:false
//   paymentMethod = "online" | "backend"
//
// IMPORTANT — Prisma OR nesting: `statusWhere("active")` emits an `OR` (endAt
// null-or-future). Search filters also emit an `OR` (id-set membership). Two
// `OR` keys cannot coexist at the same `where` level, so callers MUST combine
// independent fragments under `AND: [...]` (use `andWhere(...)`), never by
// spreading them into one object.

import { HttpError } from "../middlewares/errorHandler";

export type ReportStatus = "active" | "expired" | "inactive";

export const REPORT_STATUSES: ReportStatus[] = ["active", "expired", "inactive"];
export const isReportStatus = (v: unknown): v is ReportStatus =>
  typeof v === "string" && (REPORT_STATUSES as string[]).includes(v);

export type ReportPaymentMethod = "online" | "backend";
export const isReportPaymentMethod = (v: unknown): v is ReportPaymentMethod =>
  v === "online" || v === "backend";

/** Prisma `where` fragment for a createdAt range. Empty object when unbounded. */
export function dateWhere(dateFrom?: string, dateTo?: string): Record<string, any> {
  if (!dateFrom && !dateTo) return {};
  const createdAt: any = {};
  if (dateFrom) createdAt.gte = new Date(dateFrom);
  if (dateTo) createdAt.lte = new Date(dateTo);
  return { createdAt };
}

/**
 * Validate a caller-supplied `status` at the request boundary.
 *
 * Absent/empty is legitimate — it means "no status filter", so it returns
 * undefined. Anything else that isn't a ReportStatus throws 422 rather than
 * being quietly dropped: this filter is CASE-SENSITIVE and lower-case only, so
 * a caller sending "ACTIVE" or "revoked" previously got an unfiltered list that
 * looked correct — an admin filters to Active, gets a plausible page of rows and
 * trusts it. Silent wrong results beat loud errors nowhere.
 */
export function assertReportStatus(status: string | undefined): ReportStatus | undefined {
  if (status === undefined || status === "") return undefined;
  if (!isReportStatus(status))
    throw new HttpError(
      422,
      `Invalid status "${status}". Allowed: ${REPORT_STATUSES.join(", ")} (lower-case).`
    );
  return status;
}

/**
 * Prisma `where` fragment for a normalized status, over a row carrying a
 * `status` boolean column + an `endAt` DateTime. Absent status → `{}` (no
 * filtering); an unrecognised value THROWS — see assertReportStatus for why.
 * Callers should validate at the boundary so the 422 carries a useful message;
 * this throw is the backstop that keeps any future caller from reintroducing
 * the silent-unfiltered-result bug. NOTE: the "active" fragment contains an
 * `OR` — combine with other OR-bearing fragments via `andWhere`.
 */
export function statusWhere(status: string | undefined, now: Date = new Date()): Record<string, any> {
  switch (status) {
    case undefined:
    case "":
      return {};
    case "active":
      return { status: true, OR: [{ endAt: null }, { endAt: { gt: now } }] };
    case "expired":
      return { status: true, endAt: { lte: now } };
    case "inactive":
      return { status: false };
    default:
      throw new HttpError(
        422,
        `Invalid status "${status}". Allowed: ${REPORT_STATUSES.join(", ")} (lower-case).`
      );
  }
}

/** Combine independent (possibly OR-bearing) where fragments under a single AND. */
export function andWhere(...fragments: Array<Record<string, any> | undefined>): Record<string, any> {
  const parts = fragments.filter((f): f is Record<string, any> => !!f && Object.keys(f).length > 0);
  if (parts.length === 0) return {};
  if (parts.length === 1) return parts[0];
  return { AND: parts };
}

/** Row-level normalized status for the DTO. */
export function normalizeStatus(
  row: { status: boolean | null | undefined; endAt: Date | null | undefined },
  now: Date = new Date()
): ReportStatus {
  if (!row.status) return "inactive";
  if (row.endAt && row.endAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

// ── shared row DTO ───────────────────────────────────────────────────────────
export type ReportProductType = "course" | "package" | "liveCourse" | "testSeries";
export interface ReportProduct { _id: string; type: ReportProductType; name: string | null; image: string | null; }
export interface ReportPlan { _id: string; name: string | null; duration: number | null; price: number; }

/**
 * Builds the canonical Reports row — identical shape across all four endpoints.
 * `cust` is the raw customer row (id/fullName/phoneNumber/emailAddress); product
 * and plan are pre-shaped by the caller (each table links products differently).
 */
export function reportRow(input: {
  cust: { id: number; fullName: string | null; phoneNumber: string | null; emailAddress?: string | null } | undefined | null;
  product: ReportProduct | null;
  plan: ReportPlan | null;
  amount: number;
  paymentMethod: ReportPaymentMethod;
  status: ReportStatus;
  startAt: Date | null;
  endAt: Date | null;
  createdAt: Date | null;
}) {
  const c = input.cust;
  return {
    customer: c ? { _id: String(c.id), name: (c.fullName ?? "").trim(), phone: c.phoneNumber ?? null, email: c.emailAddress ?? null } : null,
    product: input.product,
    plan: input.plan,
    amount: input.amount,
    paymentMethod: input.paymentMethod,
    status: input.status,
    startAt: input.startAt,
    endAt: input.endAt,
    createdAt: input.createdAt,
  };
}

// ── shared report CELL helpers ────────────────────────────────────────────────
// Lifted out of admin-subscription.service on 2026-08-27 when the Live Course
// report started emitting the same columns. Both reports feed ONE frontend
// normalizer and ONE table component, so a divergence here shows up as a silently
// blank column rather than an error — keep exactly one implementation.

/** "" → null. The report renders `—` for null and a literal empty cell for "". */
export const blankStrToNull = (v: string | null | undefined): string | null => (v ? v : null);

/** Prisma Decimal|number|null → number|null (never 0 for "unknown"). */
export const decToNum = (v: any): number | null => (v != null ? Number(v) : null);

/**
 * Single source of truth for "with material" on a subscription row. Two signals
 * exist and must never disagree: legacy Mongo-migrated rows carry a `pc_material_id`
 * FK, while SQL-created admin grants carry only a `material_amount` (the create path
 * deliberately writes material_amount and never pc_material_id — see
 * createCourseSubscription). Either signal means the buyer took the physical
 * material, so the "With Material" label can never contradict a nonzero
 * materialAmount. Used by the report label, the single-detail flag, AND the
 * hasMaterial report filter (repository) so all three agree.
 */
export const rowHasMaterial = (r: { pcMaterialId?: number | null; materialAmount?: any }): boolean =>
  (r.pcMaterialId != null && r.pcMaterialId > 0) || Number(r.materialAmount ?? 0) > 0;

/**
 * bigint `tracking` (courier AWB, ~1.19e11) → number, matching the Subscriptions
 * management list (commerce-subscription transformer). Guard the >2^53 case → null.
 */
export const trackingToNumber = (v: bigint | null | undefined): number | null =>
  v == null ? null : v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : null;
