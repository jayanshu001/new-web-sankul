/**
 * Seed dummy rows into ws_package_course_subscription for load/volume testing
 * (e.g. exercising the lakhs-of-rows subscription report exports).
 *
 * Defaults to 5,00,000 (5 lakh) fully-detailed rows. Every non-null column on the
 * model is populated so the rows exercise the report/export/detail code paths just
 * like real data (order link, material/shipping/tracking, promoter %, paid amount,
 * created_by/updated_by, …).
 *
 * Every row is tagged  remarks = "DUMMY_SEED"  so it can be removed cleanly:
 *   npx tsx scripts/seed-dummy-package-course-subscriptions.ts --clean
 *
 * FK-safe: it samples REAL ids from every referenced table (ws_customer, ws_course,
 * ws_package, ws_package_course_ebook_price, ws_package_course_order,
 * ws_package_course_material, ws_customer_shipping,
 * ws_package_course_subscription_tracking, ws_promoter, ws_admin) and only ever
 * assigns ids drawn from those pools, so inserts never violate a foreign key. A row
 * is EITHER a course sub OR a package sub.
 *
 * Usage:
 *   npx tsx scripts/seed-dummy-package-course-subscriptions.ts            # 500000 rows
 *   COUNT=1000000 BATCH=10000 npx tsx scripts/seed-dummy-package-course-subscriptions.ts
 *   npx tsx scripts/seed-dummy-package-course-subscriptions.ts --clean    # delete all DUMMY_SEED rows
 *
 * ⚠ Writes to whatever DATABASE_URL points at — run against STAGING, not prod.
 */
import { prisma } from "../src/config/prisma";

const TAG = "DUMMY_SEED";
const COUNT = Number(process.env.COUNT) || 500_000; // 5 lakh
const BATCH = Number(process.env.BATCH) || 10_000;

const rand = (n: number) => Math.floor(Math.random() * n);
const pick = <T>(arr: T[]): T => arr[rand(arr.length)];
const chance = (p: number) => Math.random() < p;
const money = (n: number) => Math.round(n * 100) / 100;
const DAY = 86_400_000;

async function clean() {
  const res = await prisma.packageCourseSubscription.deleteMany({ where: { remarks: TAG } });
  console.log(`Deleted ${res.count} DUMMY_SEED rows.`);
}

async function seed() {
  console.log(`Seeding ${COUNT.toLocaleString()} dummy rows into ws_package_course_subscription (batch ${BATCH})…`);

  // Pull pools of REAL ids so FK constraints (if enforced) are satisfied. Every
  // optional FK gets its own pool; rows only ever reference ids from these pools.
  const [customers, courses, packages, plans, orders, materials, shippings, trackings, promoters, admins] =
    await Promise.all([
      prisma.customer.findMany({ select: { id: true }, take: 20_000, orderBy: { id: "desc" } }),
      prisma.course.findMany({ select: { id: true }, take: 1_000, orderBy: { id: "desc" } }),
      prisma.package.findMany({ select: { id: true }, take: 1_000, orderBy: { id: "desc" } }),
      prisma.packageCourseEbookPrice.findMany({ select: { id: true }, take: 2_000, orderBy: { id: "desc" } }),
      prisma.packageCourseOrder.findMany({ select: { id: true }, take: 20_000, orderBy: { id: "desc" } }),
      prisma.packageCourseMaterial.findMany({ select: { id: true }, take: 2_000, orderBy: { id: "desc" } }),
      prisma.customerShipping.findMany({ select: { id: true }, take: 5_000, orderBy: { id: "desc" } }),
      prisma.packageCourseSubscriptionTracking.findMany({ select: { id: true }, take: 5_000, orderBy: { id: "desc" } }),
      prisma.promoter.findMany({ select: { id: true }, take: 1_000, orderBy: { id: "desc" } }),
      prisma.adminUser.findMany({ select: { id: true }, take: 500, orderBy: { id: "desc" } }),
    ]);

  if (!customers.length) throw new Error("No ws_customer rows to sample — cannot seed FK-safe.");
  const customerIds = customers.map((c) => c.id);
  const courseIds = courses.map((c) => c.id);
  const packageIds = packages.map((p) => p.id);
  const planIds = plans.map((p) => p.id);
  const orderIds = orders.map((o) => o.id);
  const materialIds = materials.map((m) => m.id);
  const shippingIds = shippings.map((s) => s.id);
  const trackingIds = trackings.map((t) => t.id); // BigInt
  const promoterIds = promoters.map((p) => p.id);
  const adminIds = admins.map((a) => a.id);
  console.log(
    `Pools → customers ${customerIds.length}, courses ${courseIds.length}, packages ${packageIds.length}, ` +
      `plans ${planIds.length}, orders ${orderIds.length}, materials ${materialIds.length}, ` +
      `shippings ${shippingIds.length}, trackings ${trackingIds.length}, promoters ${promoterIds.length}, admins ${adminIds.length}`
  );

  const PROMO_PCTS = [5, 7.5, 10, 12.5, 15];
  const now = Date.now();
  let inserted = 0;

  for (let start = 0; start < COUNT; start += BATCH) {
    const size = Math.min(BATCH, COUNT - start);
    const rows = Array.from({ length: size }, () => {
      // EITHER a course sub OR a package sub. Fall back to the other pool if one is empty.
      const asCourse = courseIds.length ? (packageIds.length ? chance(0.6) : true) : false;
      const createdMs = now - rand(730) * DAY - rand(DAY); // random instant within ~2 years
      const startAt = new Date(createdMs);
      const endAt = new Date(createdMs + 90 * DAY); // 90-day plan window
      const online = chance(0.5);

      // Amount breakdown: course/plan portion (+ optional material portion). paidAmount
      // is what actually cleared (occasionally discounted below the list amount).
      const courseAmount = money(499 + rand(50) * 100); // ₹499 … ₹5399
      const hasMaterial = materialIds.length > 0 && chance(0.3);
      const materialAmount = hasMaterial ? money(199 + rand(20) * 50) : null; // ₹199 … ₹1149
      const amount = money(courseAmount + (materialAmount ?? 0));
      const paidAmount = money(chance(0.2) ? amount * (0.8 + Math.random() * 0.15) : amount); // ~20% discounted

      // Physical material fulfilment → shipping + (sometimes) a tracking row.
      const shippingId = hasMaterial && shippingIds.length && chance(0.4) ? pick(shippingIds) : null;
      const trackingId = shippingId != null && trackingIds.length && chance(0.6) ? pick(trackingIds) : null;

      // Online sales sometimes attributed to a promoter with a commission %.
      const viaPromoter = online && promoterIds.length > 0 && chance(0.25);
      const promoterId = viaPromoter ? pick(promoterIds) : null;
      const promoterPercentage = viaPromoter ? pick(PROMO_PCTS) : null;

      // Backend-created rows record the acting admin in created_by/updated_by.
      // ws_admin.id is BigInt while these columns are Int → coerce.
      const actor = !online && adminIds.length ? Number(pick(adminIds)) : null;

      return {
        customerId: pick(customerIds),
        orderId: orderIds.length && chance(0.9) ? pick(orderIds) : null,
        courseId: asCourse ? pick(courseIds) : null,
        packageId: asCourse ? null : pick(packageIds),
        planId: planIds.length ? pick(planIds) : null,
        pcMaterialId: hasMaterial ? pick(materialIds) : null,
        shippingId,
        trackingId,
        startAt,
        endAt,
        amount,
        courseAmount,
        materialAmount,
        paidAmount,
        status: chance(0.85), // mostly active so they surface in the reports
        payment_type: online ? ("online" as const) : ("backend" as const),
        remarks: TAG,
        promoterId,
        promoterPercentage,
        created_by: actor,
        updated_by: actor,
        createdAt: startAt,
        updatedAt: startAt,
      };
    });

    const res = await prisma.packageCourseSubscription.createMany({ data: rows });
    inserted += res.count;
    console.log(`  ${inserted.toLocaleString()} / ${COUNT.toLocaleString()}`);
  }

  console.log(`Done. Inserted ${inserted.toLocaleString()} rows (remarks="${TAG}").`);
  console.log(`Cleanup later with:  npx tsx scripts/seed-dummy-package-course-subscriptions.ts --clean`);
}

async function main() {
  if (process.argv.includes("--clean")) {
    await clean();
  } else {
    await seed();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
