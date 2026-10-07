// Async exports: registry mapping each export type to its report exporter.

// Each `type` maps to that report's existing sync exporter, so an async job's
// output is byte-identical to the sync /export endpoint; only delivery differs.

import * as subSql from "../admin-subscription/admin-subscription.service";
import * as liveSql from "../admin-live-course/admin-live-course.service";
import * as tsSql from "../admin-testseries/admin-testseries.service";
import * as ebookSql from "../admin-ebook/admin-ebook.service";
import * as bookSql from "../admin-book/admin-book.service";
import * as referralAdmin from "../../admin/referral/referral.service";
// Same param parsers as the sync /export endpoints, so the filter contract is identical.
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
  // Streamed path for keyset-paginated reports: piped into a multipart upload in
  // bounded memory. `rawFilters` is the FE `filters` object (page/limit stripped).
  resolveSource?: (rawFilters: Record<string, string>) => Promise<ReportSource>;
  // Buffer path for small non-keyset reports. Exactly one of resolveSource/build is set.
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
      // CSV-only (matches the sync /withdrawals/csv endpoint) and small, so buffered.
      if (fmt !== "csv") throw new Error("Referral withdrawals export supports CSV only.");
      return toBuf(await referralAdmin.buildWithdrawalsCsv(f as referralAdmin.WithdrawalsCsvQuery));
    },
  },
};

export const EXPORT_TYPES = Object.keys(REGISTRY);
export const isExportType = (t: string): boolean => Object.prototype.hasOwnProperty.call(REGISTRY, t);
export const getExportDef = (t: string): RegistryEntry | undefined => REGISTRY[t];
