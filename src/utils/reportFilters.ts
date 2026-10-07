// Admin reports: shared filters for the subscription Reports endpoints (Course / Package /
// Live Course / Test Series), so all four apply the same date-range and status
// contract (docs/REPORTS_SUBSCRIPTIONS_ADMIN.md).
//
// `statusWhere("active")` and the search filters both emit an `OR`; two `OR` keys
// cannot share one `where` level, so combine fragments with `andWhere(...)`, never
// by spreading them into one object.

import { HttpError } from "../middlewares/errorHandler";

export type ReportStatus = "active" | "expired" | "inactive";

export const REPORT_STATUSES: ReportStatus[] = ["active", "expired", "inactive"];
export const isReportStatus = (v: unknown): v is ReportStatus =>
  typeof v === "string" && (REPORT_STATUSES as string[]).includes(v);

export type ReportPaymentMethod = "online" | "backend";

/** Prisma `where` fragment for a createdAt range. Empty object when unbounded. */
export function dateWhere(dateFrom?: string, dateTo?: string): Record<string, any> {
  if (!dateFrom && !dateTo) return {};
  const createdAt: any = {};
  if (dateFrom) createdAt.gte = new Date(dateFrom);
  if (dateTo) createdAt.lte = new Date(dateTo);
  return { createdAt };
}

/**
 * Validate `status` at the request boundary. Absent/empty means no filter; any
 * other non-ReportStatus value (the check is case-sensitive) throws 422 instead of
 * silently returning an unfiltered list that looks correct.
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
 * Prisma `where` fragment for a status over `status` (bool) + `endAt`:
 * active = status AND (endAt null OR future), expired = status AND endAt past,
 * inactive = !status. Absent → `{}`; unknown values throw 422 as a backstop to
 * assertReportStatus. "active" contains an `OR`; combine via `andWhere`.
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

export function normalizeStatus(
  row: { status: boolean | null | undefined; startAt?: Date | null; endAt: Date | null | undefined },
  now: Date = new Date()
): ReportStatus {
  if (!row.status) return "inactive";
  // Deactivate sets end_at := start_at — a zero-length window is inactive, not active/expired.
  if (row.startAt && row.endAt && row.startAt.getTime() === row.endAt.getTime()) return "inactive";
  if (row.endAt && row.endAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

export type ReportProductType = "course" | "package" | "liveCourse" | "testSeries";
export interface ReportProduct { _id: string; type: ReportProductType; name: string | null; image: string | null; }
export interface ReportPlan { _id: string; name: string | null; duration: number | null; price: number; }

/**
 * Canonical Reports row, identical across all four endpoints. Product and plan are
 * pre-shaped by the caller since each table links products differently.
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

// Report cell helpers. Several reports feed one frontend table, so a divergent
// copy shows up as a silently blank column; keep exactly one implementation.

/** "" → null. The report renders `—` for null and a literal empty cell for "". */
export const blankStrToNull = (v: string | null | undefined): string | null => (v ? v : null);

/** Prisma Decimal|number|null → number|null (never 0 for "unknown"). */
export const decToNum = (v: any): number | null => (v != null ? Number(v) : null);

/**
 * Single source of truth for "with material" on a subscription row. Legacy rows
 * carry a `pc_material_id` FK; admin grants carry only `material_amount`
 * (createCourseSubscription never writes pc_material_id). Either signal counts.
 * Shared by the report label, the detail flag and the hasMaterial filter.
 */
export const rowHasMaterial = (r: { pcMaterialId?: number | null; materialAmount?: any }): boolean =>
  (r.pcMaterialId != null && r.pcMaterialId > 0) || Number(r.materialAmount ?? 0) > 0;

/** bigint courier AWB → number (as the Subscriptions list emits it); null past 2^53. */
export const trackingToNumber = (v: bigint | null | undefined): number | null =>
  v == null ? null : v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : null;
