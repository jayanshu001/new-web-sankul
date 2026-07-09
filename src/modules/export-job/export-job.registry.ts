// Server-side registry of exportable reports. Each `type` maps to that report's
// EXISTING sync exporter (filter parser + row builder + column spec), so an async
// job produces byte-identical output to the sync /export endpoint — only the
// delivery mechanism differs. To add a report: build its sync exporter first, then
// add one entry here. (bookOrder + referral are intentionally absent until their
// sync exporters exist — see docs/backend-requests/async-export-jobs.md.)

import * as subSql from "../admin-subscription/admin-subscription.service";
import * as liveSql from "../admin-live-course/admin-live-course.service";
import * as tsSql from "../admin-testseries/admin-testseries.service";
import * as ebookSql from "../admin-ebook/admin-ebook.service";
// Reuse each report's exact param parser (the same one its sync /export endpoint
// uses) so the filter contract is identical.
import { reportQueryFrom } from "../../admin/subscription/subscription.controller";
import { buildSubReportQuery } from "../../admin/live-course/live-course.subscription.controller";
import { parseSubReportQuery as parseTsReportQuery } from "../../admin/testSeries/testSeries.controller";
import { parseSubReportQuery as parseEbookReportQuery } from "../../admin/ebook/ebook-subscription.controller";

export type ExportFormat = "csv" | "excel";

const CSV_CT = "text/csv; charset=utf-8";
const XLSX_CT = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const extFor = (fmt: ExportFormat) => (fmt === "csv" ? "csv" : "xlsx");
export const contentTypeFor = (fmt: ExportFormat) => (fmt === "csv" ? CSV_CT : XLSX_CT);

const toBuf = (content: string | Buffer) => (Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8"));

interface RegistryEntry {
  filenameBase: string;
  // rawFilters = the FE `filters` object (string-valued, page/limit stripped).
  build: (rawFilters: Record<string, string>, format: ExportFormat) => Promise<Buffer>;
}

const REGISTRY: Record<string, RegistryEntry> = {
  subscription: {
    filenameBase: "subscription-report",
    build: async (f, fmt) => {
      const q = reportQueryFrom(f);
      return toBuf(fmt === "csv" ? await subSql.buildCourseSubscriptionsCsv(q) : await subSql.buildCourseSubscriptionsXlsx(q));
    },
  },
  liveCourseSub: {
    filenameBase: "live-course-subscriptions",
    build: async (f, fmt) => {
      const q = buildSubReportQuery(f);
      const c = fmt === "csv" ? await liveSql.buildSubscriptionsCsv(q) : await liveSql.buildSubscriptionsXlsx(q);
      // Live-course builders return a discriminated error string for a bad id.
      if (c === "bad_course") throw new Error("Invalid liveCourseId filter.");
      if (c === "bad_customer") throw new Error("Invalid customerId filter.");
      return toBuf(c);
    },
  },
  testSeriesSub: {
    filenameBase: "test-series-subscriptions",
    build: async (f, fmt) => {
      const q = parseTsReportQuery(f);
      return toBuf(fmt === "csv" ? await tsSql.buildSubscriptionsCsv(q) : await tsSql.buildSubscriptionsXlsx(q));
    },
  },
  ebookSubscription: {
    filenameBase: "ebook-subscriptions",
    build: async (f, fmt) => {
      const parsed = parseEbookReportQuery(f);
      if (!parsed.ok) throw new Error(parsed.message);
      return toBuf(fmt === "csv" ? await ebookSql.buildSubscriptionsCsv(parsed.query) : await ebookSql.buildSubscriptionsXlsx(parsed.query));
    },
  },
};

export const EXPORT_TYPES = Object.keys(REGISTRY);
export const isExportType = (t: string): boolean => Object.prototype.hasOwnProperty.call(REGISTRY, t);
export const getExportDef = (t: string): RegistryEntry | undefined => REGISTRY[t];
