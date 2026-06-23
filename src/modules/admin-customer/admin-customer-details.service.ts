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

const uniqIds = (xs: (number | null | undefined)[]): number[] =>
  [...new Set(xs.filter((x): x is number => x != null && x > 0))];

const mapById = <T extends { id: number }>(rows: T[]): Map<number, T> =>
  new Map(rows.map((r) => [r.id, r]));

const sum = (xs: (number | null | undefined)[]): number =>
  xs.reduce((acc: number, x) => acc + (Number(x) || 0), 0);

/**
 * Builds the admin customer-details aggregate (addresses + purchases + summary)
 * from MySQL, matching the legacy Mongo handler's response shape exactly. The
 * combined ws_package_course_subscription model is split into courses (rows with
 * a course_id) vs packages (rows with a package_id and no course_id), mirroring
 * the Mongo courseId / targetPackageId split.
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
  const receiptIds = [...new Set(bookOrders.map((o) => o.receiptId))];

  // Hydrate every referenced entity in parallel, then index by id. (mapById is
  // applied after the await — passing it point-free to `.then` widens the element
  // type to `{ id }` because of the empty-array fallback in the repository.)
  const [
    courseArr, packageArr, planArr, liveArr, livePlanArr,
    tsArr, tsPriceArr, ebookArr, ebookOrderArr, bookItems, stateArr,
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
    repo.bookOrderItemsByReceipts(receiptIds),
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

  const books = mapById(await repo.booksByIds(uniqIds(bookItems.map((it) => it.bookId))));
  const itemsByReceipt = new Map<string, typeof bookItems>();
  for (const it of bookItems) {
    const list = itemsByReceipt.get(it.order_id) ?? [];
    list.push(it);
    itemsByReceipt.set(it.order_id, list);
  }

  const purchases = {
    courses: courseRows.map((s) => toCourseDto(s, courses, plans, now)),
    packages: packageRows.map((s) => toPackageDto(s, packages, plans, now)),
    liveCourses: liveSubs.map((s) => toLiveCourseDto(s, liveCourses, livePlans, now)),
    testSeries: testSubs.map((s) => toTestSeriesDto(s, testSeries, testPrices, now)),
    ebooks: ebookSubs.map((s) => toEbookDto(s, ebooks, ebookOrders, now)),
    physicalBooks: bookOrders.map((o) => toPhysicalBookDto(o, itemsByReceipt, books)),
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
