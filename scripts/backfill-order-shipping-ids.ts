/**
 * Backfill: rewrite order rows whose shipping column holds a ws_customer_address
 * id into a real ws_customer_shipping id.
 *
 * WHY: `ws_package_course_order.shipping` and `ws_package_course_subscription.shipping`
 * are foreign keys to ws_customer_shipping, but the SQL client-payment and
 * admin-grant paths used to store the customer's ADDRESS-BOOK id there (the id
 * the UI hands over). Fixed at the write paths 2026-08-20; this repairs rows
 * written before that.
 *
 * Legacy (Mongo-era) rows are NOT affected — they already carry correct shipping
 * ids. Only rows whose id misses in ws_customer_shipping are considered.
 *
 * SAFE BY DEFAULT: reports and changes nothing. Pass --apply to write.
 *
 *   npx tsx scripts/backfill-order-shipping-ids.ts            # dry run
 *   npx tsx scripts/backfill-order-shipping-ids.ts --apply    # write
 */
import "dotenv/config";
import { prisma } from "../src/config/prisma";
import { resolveShippingIdForAddress } from "../src/modules/customer-shipping/customer-shipping.service";

const APPLY = process.argv.includes("--apply");

type Row = { id: number; customerId: number | null; shipping: number };

const fixed: string[] = [];
const skipped: string[] = [];

const repair = async (label: string, rows: Row[], write: (id: number, shippingId: number) => Promise<unknown>) => {
  for (const r of rows) {
    const tag = `${label}#${r.id} shipping=${r.shipping}`;
    if (r.customerId == null) { skipped.push(`${tag} — row has no customer_id`); continue; }

    // Only an address owned by THIS customer may be snapshotted. An id that is
    // neither a shipping row nor this customer's address is unresolvable — report
    // it rather than guess, since guessing would put someone else's address on
    // the order.
    const addr = await prisma.customerAddress.findFirst({ where: { id: r.shipping, userId: r.customerId }, select: { id: true } });
    if (!addr) { skipped.push(`${tag} — id is neither a shipping row nor customer ${r.customerId}'s address`); continue; }

    // includeSoftDeleted: an order placed against an address the customer later
    // deleted still needs repairing. refreshOnReuse:false so a repair can never
    // rewrite an existing shipping row that live orders already point at.
    // createIfMissing is tied to APPLY, so a dry run is strictly READ-ONLY and
    // cannot leave a half-made snapshot behind.
    // refreshOnReuse:false so a repair never rewrites an existing shipping row
    // that live orders already point at.
    const resolved = await resolveShippingIdForAddress(r.customerId, r.shipping, {
      includeSoftDeleted: true,
      refreshOnReuse: false,
      createIfMissing: APPLY,
    });
    if (!resolved.ok && resolved.reason === "snapshot_missing") {
      fixed.push(`${tag} → would CREATE a new snapshot from address ${r.shipping}`);
      continue;
    }
    if (!resolved.ok) { skipped.push(`${tag} — address ${r.shipping} unusable (${resolved.reason})`); continue; }
    if (APPLY) await write(r.id, resolved.shippingId);
    fixed.push(`${tag} → shipping ${resolved.shippingId}`);
  }
};

const main = async () => {
  console.log(APPLY ? "MODE: APPLY (writing)\n" : "MODE: DRY RUN (no writes — pass --apply to write)\n");

  const orders = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT o.id AS id, o.customer_id AS customerId, o.shipping AS shipping
      FROM ws_package_course_order o
      LEFT JOIN ws_customer_shipping s ON s.id = o.shipping
     WHERE o.shipping > 0 AND s.id IS NULL`);
  const subs = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT sub.id AS id, sub.customer_id AS customerId, sub.shipping AS shipping
      FROM ws_package_course_subscription sub
      LEFT JOIN ws_customer_shipping s ON s.id = sub.shipping
     WHERE sub.shipping > 0 AND s.id IS NULL`);

  console.log(`ws_package_course_order        : ${orders.length} row(s) with an unresolvable shipping id`);
  console.log(`ws_package_course_subscription : ${subs.length} row(s) with an unresolvable shipping id\n`);

  await repair("order", orders.map((r) => ({ ...r, id: Number(r.id), customerId: r.customerId == null ? null : Number(r.customerId), shipping: Number(r.shipping) })),
    (id, shippingId) => prisma.packageCourseOrder.update({ where: { id }, data: { shipping: shippingId } }));
  await repair("subscription", subs.map((r) => ({ ...r, id: Number(r.id), customerId: r.customerId == null ? null : Number(r.customerId), shipping: Number(r.shipping) })),
    (id, shippingId) => prisma.packageCourseSubscription.update({ where: { id }, data: { shippingId } }));

  console.log(`${APPLY ? "REPAIRED" : "WOULD REPAIR"} (${fixed.length}):`);
  for (const f of fixed) console.log("  ✓ " + f);
  console.log(`\nSKIPPED — needs a human (${skipped.length}):`);
  for (const s of skipped) console.log("  ! " + s);
  if (!APPLY && fixed.length) console.log("\nRe-run with --apply to write these.");
  await prisma.$disconnect();
};
main();
