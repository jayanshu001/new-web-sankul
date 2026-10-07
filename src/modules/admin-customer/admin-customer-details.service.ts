// Admin customer details: a customer's subscriptions, book orders and addresses.
import { adminCustomerDetailsRepository as repo } from "./admin-customer-details.repository";
import {
  toCourseDto,
  toPackageDto,
  toLiveCourseDto,
  toTestSeriesDto,
  toEbookDto,
  toPhysicalBookDto,
  toAddressDto,
} from "./admin-customer-details.transformer";
import { isDeactivatedWindow } from "../../utils/subscriptionRemarkHistory";
import { enrichOrders } from "../admin-book/admin-book.service";

const uniqIds = (xs: (number | null | undefined)[]): number[] =>
  [...new Set(xs.filter((x): x is number => x != null && x > 0))];

const mapById = <T extends { id: number }>(rows: T[]): Map<number, T> =>
  new Map(rows.map((r) => [r.id, r]));

const sum = (xs: (number | null | undefined)[]): number =>
  xs.reduce((acc: number, x) => acc + (Number(x) || 0), 0);

/**
 * Admin customer-details aggregate (addresses + purchases + summary). The shared
 * ws_package_course_subscription table is split into courses (course_id set) vs
 * packages (package_id set, no course_id).
 */
export const getCustomerPurchaseDetails = async (customerId: number, now: Date) => {
  const [pkgSubs, liveSubs, testSubs, ebookSubs, bookOrders, addrRows] = await Promise.all([
    repo.packageCourseSubs(customerId),
    repo.liveCourseSubs(customerId),
    repo.testSeriesSubs(customerId),
    repo.ebookSubs(customerId),
    repo.bookOrders(customerId),
    repo.addresses(customerId),
  ]);

  const courseRows = pkgSubs.filter((s) => s.courseId != null);
  const packageRows = pkgSubs.filter((s) => s.courseId == null && s.packageId != null);

  // mapById is applied after the await: passing it point-free to `.then` widens the
  // element type to `{ id }` because of the repository's empty-array fallback.
  const [
    courseArr, packageArr, planArr, liveArr, livePlanArr,
    tsArr, tsPriceArr, ebookArr, ebookOrderArr, enrichedBookOrders, stateArr,
  ] = await Promise.all([
    repo.coursesByIds(uniqIds(courseRows.map((s) => s.courseId))),
    repo.packagesByIds(uniqIds(packageRows.map((s) => s.packageId))),
    repo.plansByIds(uniqIds(pkgSubs.map((s) => s.planId))),
    repo.liveCoursesByIds(uniqIds(liveSubs.map((s) => s.liveCourseId))),
    repo.liveCoursePlansByIds(uniqIds(liveSubs.map((s) => s.planId))),
    repo.testSeriesByIds(uniqIds(testSubs.map((s) => s.testSeriesId))),
    repo.testSeriesPricesByIds(uniqIds(testSubs.map((s) => s.planId))),
    repo.ebooksByIds(uniqIds(ebookSubs.map((s) => s.ebookId))),
    repo.ebookOrdersByIds(uniqIds(ebookSubs.map((s) => s.orderId))),
    enrichOrders(bookOrders),
    repo.statesByIds(uniqIds(addrRows.map((a) => a.state))),
  ]);

  const courses = mapById(courseArr);
  const packages = mapById(packageArr);
  const plans = mapById(planArr);
  const liveCourses = mapById(liveArr);
  const livePlans = mapById(livePlanArr);
  const testSeries = mapById(tsArr);
  const testPrices = mapById(tsPriceArr);
  const ebooks = mapById(ebookArr);
  const ebookOrders = mapById(ebookOrderArr);
  const states = mapById(stateArr);

  const purchases = {
    courses: courseRows.map((s) => toCourseDto(s, courses, plans, now)),
    packages: packageRows.map((s) => toPackageDto(s, packages, plans, now)),
    liveCourses: liveSubs.map((s) => toLiveCourseDto(s, liveCourses, livePlans, now)),
    testSeries: testSubs.map((s) => toTestSeriesDto(s, testSeries, testPrices, now)),
    ebooks: ebookSubs.map((s) => toEbookDto(s, ebooks, ebookOrders, now)),
    physicalBooks: enrichedBookOrders.map(toPhysicalBookDto),
  };
  const addresses = addrRows.map((a) => toAddressDto(a, states));

  const summary = {
    totals: {
      courses: purchases.courses.length,
      packages: purchases.packages.length,
      liveCourses: purchases.liveCourses.length,
      testSeries: purchases.testSeries.length,
      ebooks: purchases.ebooks.length,
      physicalBooks: purchases.physicalBooks.length,
      addresses: addresses.length,
    },
    active: {
      courses: purchases.courses.filter((x) => x.isActive).length,
      packages: purchases.packages.filter((x) => x.isActive).length,
      liveCourses: purchases.liveCourses.filter((x) => x.isActive).length,
      testSeries: purchases.testSeries.filter((x) => x.isActive).length,
      ebooks: purchases.ebooks.filter((x) => x.isActive).length,
    },
    lifetimeSpend:
      sum(purchases.courses.map((x) => x.paidAmount)) +
      sum(purchases.packages.map((x) => x.paidAmount)) +
      sum(purchases.liveCourses.map((x) => x.paidAmount)) +
      sum(purchases.testSeries.map((x) => x.price)) +
      sum(purchases.ebooks.map((x) => x.price)) +
      sum(purchases.physicalBooks.map((x) => x.amount)),
  };

  return { addresses, purchases, summary };
};

// Per-tab paginated lists: { data, total }, paged in the DB and hydrating only the
// page's referenced entities. Row DTOs match the aggregate's `purchases`.

type ListArgs = { skip: number; take: number; status?: boolean };

type SubWindow = { id: number; productId: number | null; startAt: Date | null; endAt: Date | null };

/**
 * Deactivation walks a product's rows newest → oldest, and Revert undoes them in
 * reverse. So per product, Deactivate belongs to the newest row that isn't
 * deactivated, and Revert to the deactivated row directly above it (the oldest row
 * once every row is deactivated). Rows are ordered by start date (then id) — a
 * transfer can queue an older row after a newer one, so id alone isn't the sequence.
 */
const deactivationTurns = (windows: SubWindow[]) => {
  const byProduct = new Map<number, SubWindow[]>();
  for (const w of windows) {
    if (w.productId == null) continue;
    byProduct.set(w.productId, [...(byProduct.get(w.productId) ?? []), w]);
  }
  const canDeactivate = new Set<number>();
  const canRevert = new Set<number>();
  for (const rows of byProduct.values()) {
    rows.sort((a, b) => (b.startAt?.getTime() ?? 0) - (a.startAt?.getTime() ?? 0) || b.id - a.id);
    const next = rows.findIndex((r) => !isDeactivatedWindow(r));
    if (next >= 0) canDeactivate.add(rows[next].id);
    const lastDeactivated = next === -1 ? rows[rows.length - 1] : rows[next - 1];
    if (lastDeactivated) canRevert.add(lastDeactivated.id);
  }
  return (id: number) => ({ canDeactivate: canDeactivate.has(id), canRevert: canRevert.has(id) });
};

export const listCustomerCourseSubscriptions = async (
  customerId: number, { skip, take, status }: ListArgs, now: Date
) => {
  const [rows, total] = await Promise.all([
    repo.pageCourseSubs(customerId, skip, take, status),
    repo.countCourseSubs(customerId, status),
  ]);
  const courseIds = uniqIds(rows.map((s) => s.courseId));
  const [courseArr, planArr, windows] = await Promise.all([
    repo.coursesByIds(courseIds),
    repo.plansByIds(uniqIds(rows.map((s) => s.planId))),
    repo.courseSubWindows(customerId, courseIds),
  ]);
  const courses = mapById(courseArr);
  const plans = mapById(planArr);
  const turnOf = deactivationTurns(windows.map((w) => ({ ...w, productId: w.courseId })));
  return { data: rows.map((s) => ({ ...toCourseDto(s, courses, plans, now), ...turnOf(s.id) })), total };
};

export const listCustomerPackageSubscriptions = async (
  customerId: number, { skip, take, status }: ListArgs, now: Date
) => {
  const [rows, total] = await Promise.all([
    repo.pagePackageSubs(customerId, skip, take, status),
    repo.countPackageSubs(customerId, status),
  ]);
  const packageIds = uniqIds(rows.map((s) => s.packageId));
  const [packageArr, planArr, windows] = await Promise.all([
    repo.packagesByIds(packageIds),
    repo.plansByIds(uniqIds(rows.map((s) => s.planId))),
    repo.packageSubWindows(customerId, packageIds),
  ]);
  const packages = mapById(packageArr);
  const plans = mapById(planArr);
  const turnOf = deactivationTurns(windows.map((w) => ({ ...w, productId: w.packageId })));
  const data = rows.map((s) => ({ ...toPackageDto(s, packages, plans, now), ...turnOf(s.id) }));
  return { data, total };
};

export const listCustomerLiveCourseSubscriptions = async (
  customerId: number, { skip, take, status }: ListArgs, now: Date
) => {
  const [rows, total] = await Promise.all([
    repo.pageLiveCourseSubs(customerId, skip, take, status),
    repo.countLiveCourseSubs(customerId, status),
  ]);
  const liveCourseIds = uniqIds(rows.map((s) => s.liveCourseId));
  const [liveArr, livePlanArr, windows] = await Promise.all([
    repo.liveCoursesByIds(liveCourseIds),
    repo.liveCoursePlansByIds(uniqIds(rows.map((s) => s.planId))),
    repo.liveCourseSubWindows(customerId, liveCourseIds),
  ]);
  const liveCourses = mapById(liveArr);
  const livePlans = mapById(livePlanArr);
  const turnOf = deactivationTurns(windows.map((w) => ({ ...w, productId: w.liveCourseId })));
  return { data: rows.map((s) => ({ ...toLiveCourseDto(s, liveCourses, livePlans, now), ...turnOf(s.id) })), total };
};

export const listCustomerTestSeriesSubscriptions = async (
  customerId: number, { skip, take, status }: ListArgs, now: Date
) => {
  const [rows, total] = await Promise.all([
    repo.pageTestSeriesSubs(customerId, skip, take, status),
    repo.countTestSeriesSubs(customerId, status),
  ]);
  const [tsArr, tsPriceArr] = await Promise.all([
    repo.testSeriesByIds(uniqIds(rows.map((s) => s.testSeriesId))),
    repo.testSeriesPricesByIds(uniqIds(rows.map((s) => s.planId))),
  ]);
  const testSeries = mapById(tsArr);
  const testPrices = mapById(tsPriceArr);
  return { data: rows.map((s) => toTestSeriesDto(s, testSeries, testPrices, now)), total };
};

export const listCustomerEbookSubscriptions = async (
  customerId: number, { skip, take }: ListArgs, now: Date
) => {
  const [rows, total] = await Promise.all([
    repo.pageEbookSubs(customerId, skip, take),
    repo.countEbookSubs(customerId),
  ]);
  const [ebookArr, ebookOrderArr] = await Promise.all([
    repo.ebooksByIds(uniqIds(rows.map((s) => s.ebookId))),
    repo.ebookOrdersByIds(uniqIds(rows.map((s) => s.orderId))),
  ]);
  const ebooks = mapById(ebookArr);
  const ebookOrders = mapById(ebookOrderArr);
  return { data: rows.map((s) => toEbookDto(s, ebooks, ebookOrders, now)), total };
};

export const listCustomerBookOrders = async (
  customerId: number, { skip, take }: ListArgs
) => {
  const [rows, total] = await Promise.all([
    repo.pageBookOrders(customerId, skip, take),
    repo.countBookOrders(customerId),
  ]);
  return { data: (await enrichOrders(rows)).map(toPhysicalBookDto), total };
};

export const listCustomerAddresses = async (
  customerId: number, { skip, take }: ListArgs
) => {
  const [rows, total] = await Promise.all([
    repo.pageAddresses(customerId, skip, take),
    repo.countAddresses(customerId),
  ]);
  const states = mapById(await repo.statesByIds(uniqIds(rows.map((a) => a.state))));
  return { data: rows.map((a) => toAddressDto(a, states)), total };
};
