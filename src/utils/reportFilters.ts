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
 * Prisma `where` fragment for a normalized status, over a row carrying a
 * `status` boolean column + an `endAt` DateTime. Returns `{}` for an
 * unrecognised/absent value (no filtering). NOTE: the "active" fragment
 * contains an `OR` — combine with other OR-bearing fragments via `andWhere`.
 */
export function statusWhere(status: string | undefined, now: Date = new Date()): Record<string, any> {
  switch (status) {
    case "active":
      return { status: true, OR: [{ endAt: null }, { endAt: { gt: now } }] };
    case "expired":
      return { status: true, endAt: { lte: now } };
    case "inactive":
      return { status: false };
    default:
      return {};
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
