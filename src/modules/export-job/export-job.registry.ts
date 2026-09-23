// Server-side registry of exportable reports. Each `type` maps to that report's
// EXISTING sync exporter (filter parser + row builder + column spec), so an async
// job produces byte-identical output to the sync /export endpoint — only the
// delivery mechanism differs. Every builder is now uncapped + streamed, so large
// (lakhs-of-rows) exports run off-request without the gateway 504.

import * as subSql from "../admin-subscription/admin-subscription.service";
import * as liveSql from "../admin-live-course/admin-live-course.service";
import * as tsSql from "../admin-testseries/admin-testseries.service";
import * as ebookSql from "../admin-ebook/admin-ebook.service";
import * as bookSql from "../admin-book/admin-book.service";
import * as referralAdmin from "../../admin/referral/referral.service";
// Reuse each report's exact param parser (the same one its sync /export endpoint
// uses) so the filter contract is identical.
import { reportQueryFrom } from "../../admin/subscription/subscription.controller";
import { buildSubReportQuery } from "../../admin/live-course/live-course.subscription.controller";
import { parseSubReportQuery as parseTsReportQuery } from "../../admin/testSeries/testSeries.controller";
import { parseSubReportQuery as parseEbookReportQuery } from "../../admin/ebook/ebook-subscription.controller";
import { parseOrderReportQuery } from "../../admin/book/book.controller";
import type { ReportSource } from "../../utils/reportStream";

export type ExportFormat = "csv" | "excel";

const CSV_CT = "text/csv; charset=utf-8";
const XLSX_CT = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const extFor = (fmt: ExportFormat) => (fmt === "csv" ? "csv" : "xlsx");
export const contentTypeFor = (fmt: ExportFormat) => (fmt === "csv" ? CSV_CT : XLSX_CT);

const toBuf = (content: string | Buffer) => (Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8"));

interface RegistryEntry {
  filenameBase: string;
  // Streamed path (preferred): expose the report as a header + row-batch source so
  // the worker pipes it straight into a multipart upload — no full-file buffer. Used
  // by every keyset-paginated report so lakhs-of-rows exports run in bounded memory.
  // `rawFilters` = the FE `filters` object (string-valued, page/limit stripped).
  resolveSource?: (rawFilters: Record<string, string>) => Promise<ReportSource>;
  // Buffer path (legacy): for small, non-keyset reports (referral withdrawals) that
  // return a fully-materialized string. Only ONE of resolveSource/build is set.
  build?: (rawFilters: Record<string, string>, format: ExportFormat) => Promise<Buffer>;
}

const REGISTRY: Record<string, RegistryEntry> = {
  subscription: {
    filenameBase: "subscription-report",
    resolveSource: async (f) => subSql.courseSubExportSource(reportQueryFrom(f)),
  },
  liveCourseSub: {
    filenameBase: "live-course-subscriptions",
    // liveSubExportSource throws on a bad id filter — the worker marks the job failed.
    resolveSource: async (f) => liveSql.liveSubExportSource(buildSubReportQuery(f)),
  },
  testSeriesSub: {
    filenameBase: "test-series-subscriptions",
    resolveSource: async (f) => tsSql.tsSubExportSource(parseTsReportQuery(f)),
  },
  ebookSubscription: {
    filenameBase: "ebook-subscriptions",
    resolveSource: async (f) => {
      const parsed = parseEbookReportQuery(f);
      if (!parsed.ok) throw new Error(parsed.message);
      return ebookSql.ebookSubExportSource(parsed.query);
    },
  },
  bookOrder: {
    filenameBase: "book-orders",
    resolveSource: async (f) => bookSql.orderExportSource(parseOrderReportQuery(f)),
  },
  referral: {
    filenameBase: "referral-withdrawals",
    build: async (f, fmt) => {
      // Referral withdrawals export is CSV-only (matches the sync /withdrawals/csv
      // endpoint + the FE, which offers no Excel here) and is small (not keyset-paged),
      // so it stays on the buffer path.
      if (fmt !== "csv") throw new Error("Referral withdrawals export supports CSV only.");
      return toBuf(await referralAdmin.buildWithdrawalsCsv(f as referralAdmin.WithdrawalsCsvQuery));
    },
  },
};

export const EXPORT_TYPES = Object.keys(REGISTRY);
export const isExportType = (t: string): boolean => Object.prototype.hasOwnProperty.call(REGISTRY, t);
export const getExportDef = (t: string): RegistryEntry | undefined => REGISTRY[t];
