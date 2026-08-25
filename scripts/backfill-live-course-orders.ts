/**
 * Backfill `ws_live_course_order` from the historical `ws_live_course_subscription`
 * rows, and link each subscription back via `order_id`.
 *
 * WHY. Live course used to be SINGLE-TABLE: the subscription row was also the order,
 * so checkout wrote a `payment_status='pending'` subscription and verify flipped it
 * to 'verified'. On 2026-08-25 payment moved to its own table so that each purchase —
 * including a renewal — records its own money (see MIGRATION_QUERY_CHANGES
 * 2026-08-25 (f)). Every pre-existing row therefore needs an order minted from the
 * payment columns it already carries.
 *
 * WHAT IT DOES, per subscription with `order_id IS NULL`:
 *   1. INSERT a ws_live_course_order carrying that row's payment columns verbatim
 *      (paid/original amount, wallet coin, code snapshots, method, gateway + bank
 *      references, paid_at, material flags, remarks, audit columns).
 *      `payment_status` maps to the order vocabulary: verified→complete,
 *      failed→failed, anything else (including NULL)→pending.
 *   2. UPDATE the subscription's `order_id` to point at it.
 *   3. If the row was NEVER a completed purchase (payment_status ≠ 'verified'), also
 *      set `status = false`.
 *
 * WHY STEP 3 MATTERS — read this before changing it. The entitlement reads used to
 * gate on `status = true AND payment_status = 'verified'`. They now gate on `status`
 * alone, because a subscription row is only ever written for a paid order. That is
 * true for every NEW row, but an abandoned checkout from BEFORE this migration left a
 * `pending` row with `status = true` sitting in the table. Without step 3 those rows
 * would silently become live entitlements the moment the new code deploys — someone
 * who abandoned a payment would get the course for free. Step 3 is the whole reason
 * dropping the payment_status filter is safe.
 *
 * ORDERING. Run this AFTER 2026-08-25_create_ws_live_course_order.sql and BEFORE (or
 * at the same time as) deploying the application code. Running it early is harmless:
 * it only writes the new table and two columns nothing reads yet.
 *
 * All writes go through Prisma so the IST read/write shift round-trips correctly —
 * do NOT rewrite this with raw SQL, which bypasses the shift.
 *
 * Idempotent: only touches subscriptions whose `order_id IS NULL`, so a second run
 * is a no-op. Batched by primary key (never one unbounded UPDATE — see the 2026-08-06
 * ws_customer incident) and resumable: interrupt it and re-run.
 *
 *   npx tsx scripts/backfill-live-course-orders.ts          # dry run
 *   npx tsx scripts/backfill-live-course-orders.ts --apply  # write
 */
import { prisma } from "../src/config/prisma";

const APPLY = process.argv.includes("--apply");
const BATCH = 500;

/** Subscription payment_status → order status. NULL/unknown is treated as unpaid. */
const toOrderStatus = (paymentStatus: string | null): "complete" | "failed" | "pending" =>
  paymentStatus === "verified" ? "complete" : paymentStatus === "failed" ? "failed" : "pending";

async function main() {
  const pending = await prisma.liveCourseSubscription.count({ where: { orderId: null } });
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${pending} subscription row(s) without an order.`);
  if (!pending) return;

  let cursor = 0;
  let made = 0;
  let deactivated = 0;

  for (;;) {
    const rows = await prisma.liveCourseSubscription.findMany({
      where: { orderId: null, id: { gt: cursor } },
      orderBy: { id: "asc" },
      take: BATCH,
    });
    if (!rows.length) break;
    cursor = rows[rows.length - 1].id;

    for (const s of rows) {
      const status = toOrderStatus(s.paymentStatus);
      const unpaid = status !== "complete";

      if (!APPLY) {
        console.log(
          `  sub ${s.id}: → order(status=${status}, paid=${s.paidAmount ?? 0})` +
            (unpaid && s.status ? "  + deactivate subscription (was an unpaid row)" : "")
        );
        made++;
        if (unpaid && s.status) deactivated++;
        continue;
      }

      // One transaction per subscription: the order and its link must not diverge.
      await prisma.$transaction(async (tx) => {
        const order = await tx.liveCourseOrder.create({
          data: {
            customerId: s.customerId,
            liveCourseId: s.liveCourseId,
            planId: s.planId,
            paidAmount: s.paidAmount,
            originalAmount: s.originalAmount,
            walletCoin: s.walletCoin,
            // Copied as-is. `?? undefined` leaves a JSON column untouched (SQL NULL)
            // rather than writing the JSON literal `null`, which every JSON_EXTRACT
            // path in the reports would then miss.
            promocode: (s.promocode as any) ?? undefined,
            refferalcode: (s.refferalcode as any) ?? undefined,
            paymentMethod: s.paymentMethod,
            razorpayOrderId: s.razorpayOrderId,
            razorpayPaymentId: s.razorpayPaymentId,
            bankTransactionId: s.bankTransactionId,
            status,
            paidAt: s.paidAt,
            withMaterial: s.withMaterial,
            customerShippingId: s.customerShippingId,
            remarks: s.remarks,
            // Preserve the original purchase instant — reports window on it.
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
            created_by: s.created_by,
            updated_by: s.updated_by,
          },
        });
        await tx.liveCourseSubscription.update({
          where: { id: s.id },
          data: {
            orderId: order.id,
            // See the header: an unpaid legacy row must not become an entitlement
            // once the reads stop consulting payment_status.
            ...(unpaid && s.status ? { status: false } : {}),
          },
        });
      });

      made++;
      if (unpaid && s.status) deactivated++;
    }
    console.log(`  …${made}/${pending}`);
  }

  console.log(
    `${APPLY ? "Done" : "Would create"}: ${made} order(s); ` +
      `${deactivated} never-paid subscription(s) ${APPLY ? "deactivated" : "would be deactivated"}.`
  );
  if (!APPLY) console.log("Re-run with --apply to write.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
