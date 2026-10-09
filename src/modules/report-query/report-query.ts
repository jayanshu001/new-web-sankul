// Report query parsers: map admin report query strings to service filter options.
// Shared by the report HTTP handlers and the async export registry, so it lives
// under modules/ (a module must not import an HTTP controller).
import { assertReportStatus, isReportStatus, REPORT_STATUSES } from "../../utils/reportFilters";
import * as subSql from "../admin-subscription/admin-subscription.service";
import * as liveSql from "../admin-live-course/admin-live-course.service";
import * as tsSql from "../admin-testseries/admin-testseries.service";
import * as adminEbook from "../admin-ebook/admin-ebook.service";
import * as adminBook from "../admin-book/admin-book.service";

// Shared filter mapping for the report list and its CSV/Excel exports. The date
// range bounds `createdAt` at IST day boundaries via `createdFrom`/`createdTo`
// (`dateFrom`/`dateTo` and `fromDate`/`toDate` are legacy aliases);
// startFrom/startTo and endFrom/endTo still filter startAt/endAt.
export const reportQueryFrom = (q: Record<string, string>): subSql.CourseSubReportQuery => ({
  customerId: q.customerId, courseId: q.courseId, packageId: q.packageId, type: q.type,
  // 422s an unrecognised status instead of silently returning an unfiltered list.
  status: assertReportStatus(q.status), paymentMethod: q.paymentMethod,
  // tri-state: absent = no filter, "true" = with material, "false" = without.
  hasMaterial: q.hasMaterial === "true" ? true : q.hasMaterial === "false" ? false : undefined,
  // tri-state Ws Coin filter (order.ws_coin): "true" = redeemed (>0), "false" = not.
  hasWsCoin: q.hasWsCoin === "true" ? true : q.hasWsCoin === "false" ? false : undefined,
  // promoter / promocode filters + orderMethod (payment gateway, ≠ paymentMethod).
  promoterId: q.promoterId, promocodeId: q.promocodeId, orderMethod: q.orderMethod,
  dateFrom: q.createdFrom ?? q.dateFrom ?? q.fromDate, dateTo: q.createdTo ?? q.dateTo ?? q.toDate,
  startFrom: q.startFrom, startTo: q.startTo, endFrom: q.endFrom, endTo: q.endTo,
  activationType: q.activationType,
  search: q.search, sortBy: q.sortBy, sortOrder: q.sortOrder,
});

// Shared by the report list and its CSV/Excel exports so all three honor one param
// contract. `:id` (when present) pins the liveCourseId filter.
export const buildLiveCourseSubReportQuery = (q: Record<string, string>, paramsId?: string | string[]): liveSql.SubReportQuery => ({
  liveCourseId: paramsId ? String(paramsId) : (q.liveCourseId ? String(q.liveCourseId) : undefined),
  customerId: q.customerId ? String(q.customerId) : undefined,
  // 422s an unrecognised status instead of silently returning an unfiltered list.
  status: assertReportStatus(q.status),
  paymentMethod: q.paymentMethod,
  activationType: q.activationType,
  // Bounds `createdAt` at IST day edges. dateFrom/dateTo and fromDate/toDate are
  // legacy aliases of createdFrom/createdTo.
  dateFrom: q.createdFrom ?? q.dateFrom ?? q.fromDate,
  dateTo: q.createdTo ?? q.dateTo ?? q.toDate,
  startFrom: q.startFrom,
  endTo: q.endTo,
  search: q.search,
  sortBy: q.sortBy,
  sortOrder: q.sortOrder,
});

// Shared filter mapping for the subscription report list and its CSV/Excel
// exports (page/limit apply only to the paginated list).
export const parseTestSeriesSubReportQuery = (q: Record<string, string>): tsSql.SubReportOpts => ({
  testSeriesId: q.testSeriesId ? tsSql.parseAtsId(q.testSeriesId) : null,
  customerId: q.customerId ? tsSql.parseAtsId(q.customerId) : null,
  // 422s an unrecognised status instead of silently returning an unfiltered list.
  status: assertReportStatus(q.status),
  paymentMethod: q.paymentMethod,
  // Date range bounds `createdAt` at IST day edges; dateFrom/dateTo and
  // fromDate/toDate are legacy aliases of createdFrom/createdTo.
  dateFrom: q.createdFrom ?? q.dateFrom ?? q.fromDate,
  dateTo: q.createdTo ?? q.dateTo ?? q.toDate,
  search: q.search,
  sortBy: q.sortBy,
  sortOrder: q.sortOrder,
});

// Shared by the report list and its CSV/Excel exports so all three honor one param contract.
export const parseEbookSubReportQuery = (
  q: Record<string, string>,
): { ok: false; message: string } | { ok: true; query: adminEbook.SubReportQuery } => {
  if (q.customerId && !adminEbook.parseEbookId(q.customerId)) return { ok: false, message: "Invalid customerId" };
  if (q.ebookId && !adminEbook.parseEbookId(q.ebookId)) return { ok: false, message: "Invalid ebookId" };
  const paymentMethodEnum = adminEbook.coercePaymentMethod(q.paymentMethod);
  if (q.paymentMethod && !paymentMethodEnum) return { ok: false, message: "Invalid paymentMethod" };
  // active|expired|inactive, plus legacy true/false. Anything else is rejected:
  // it would otherwise return a silently unfiltered list. Not using
  // assertReportStatus only because this report also accepts true/false.
  if (q.status && !isReportStatus(q.status) && q.status !== "true" && q.status !== "false")
    return {
      ok: false,
      message: `Invalid status "${q.status}". Allowed: ${REPORT_STATUSES.join(", ")} (lower-case).`,
    };
  const statusFilter = isReportStatus(q.status) ? q.status : undefined;
  return {
    ok: true,
    query: {
      customerId: q.customerId ? adminEbook.parseEbookId(q.customerId)! : undefined,
      ebookId: q.ebookId ? adminEbook.parseEbookId(q.ebookId)! : undefined,
      status: q.status === "true" ? true : q.status === "false" ? false : undefined,
      statusFilter,
      paymentMethod: paymentMethodEnum,
      // Bounds createdAt at IST day edges; dateFrom/dateTo are legacy aliases.
      dateFrom: adminEbook.parseDateBound(q.createdFrom ?? q.dateFrom, false),
      dateTo: adminEbook.parseDateBound(q.createdTo ?? q.dateTo, true),
      search: q.search,
      sortBy: q.sortBy,
      sortOrder: q.sortOrder,
    },
  };
};

// Shared filter mapping for the orders report list and its CSV/Excel exports.
export const parseOrderReportQuery = (q: Record<string, string>): adminBook.OrderReportQuery => ({
  customerId: q.customerId,
  bookId: q.bookId,
  state: q.state,
  // Date range bounds `createdAt` at IST day edges; dateFrom/dateTo and
  // fromDate/toDate are legacy aliases of createdFrom/createdTo.
  fromDate: q.createdFrom ?? q.dateFrom ?? q.fromDate,
  toDate: q.createdTo ?? q.dateTo ?? q.toDate,
  search: q.search,
  sortBy: q.sortBy,
  sortOrder: q.sortOrder,
});
