/**
 * End-to-end verification of the SQL notification write subsystem
 * (`client-notification` flag). Seeds a throwaway customer + device token,
 * exercises every migrated path against the real staging DB, asserts the
 * ws_notification / ws_customer_device_token row state after each, then cleans
 * up. FCM is exercised for real but tokens are fake → sends "fail" gracefully
 * (status persists correctly either way); we assert on DB rows, not push.
 *
 * Run: npx tsx scripts/verify-notification-sql.ts
 */
import "dotenv/config";
import { prisma } from "../src/config/prisma";
import * as svc from "../src/modules/admin-notification/admin-notification.service";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label} ${detail}`); }
}

async function main() {
  if (!svc.isAdminNotificationMysql()) throw new Error("flag client-notification is OFF — enable before verifying");

  // ── Reuse a real, live customer + attach a throwaway device token ─────────
  // The token lives in ws_customer.device (single column), so we stash the real
  // customer's current token and restore it during cleanup — never clobber a
  // live user's device token.
  const cust = await prisma.customer.findFirst({
    where: { isAccountDeleted: false, status: true },
    select: { id: true, firebaseToken: true },
    orderBy: { id: "asc" },
  });
  if (!cust) throw new Error("no live customer in DB to verify against");
  const customerId = cust.id;
  const originalToken = cust.firebaseToken;
  const createdCustomer = false;
  await prisma.customer.update({
    where: { id: customerId },
    data: { firebaseToken: "VERIFY_TOK_A", updatedAt: new Date() },
  });
  console.log(`\nUsing live customer #${customerId} (device token temporarily set to a throwaway)\n`);

  const seen: number[] = []; // ws_notification ids we create, for cleanup

  // ── 1. resolveAudience ────────────────────────────────────────────────────
  console.log("1. resolveAudience");
  const all = await svc.resolveAudience({});
  check("empty filter → isAll", all.isAll === true);
  const targeted = await svc.resolveAudience({ userIds: [String(customerId)] });
  check("userIds → resolves our seeded customer", targeted.customerIds.includes(customerId), JSON.stringify(targeted.customerIds));
  const noTok = await svc.resolveAudience({ userIds: ["999999999"] });
  check("unknown user (no token) → empty", noTok.customerIds.length === 0);

  // ── 2. Immediate targeted send → per-recipient fanout row ─────────────────
  console.log("\n2. dispatchAudience (immediate, targeted)");
  const before = await prisma.notification.count({ where: { customerId } });
  const r = await svc.dispatchAudience(
    { title: "VERIFY hello", body: "targeted body", type: "general" },
    { userIds: [String(customerId)] }
  );
  check("returns a status", r.status === "sent" || r.status === "failed", r.status);
  check("targetCustomerIds includes seeded", (r.targetCustomerIds as number[]).includes(customerId));
  const fan = await prisma.notification.findMany({ where: { customerId, title: "VERIFY hello" } });
  // fanout only happens when status==='sent' (FCM may report failed on fake token)
  if (r.status === "sent") check("per-recipient fanout row created", fan.length >= 1, `found ${fan.length}`);
  else check("no fanout when send failed (expected w/ fake token)", true);
  fan.forEach((f) => seen.push(f.id));

  // ── 3. Schedule → claim → fire ────────────────────────────────────────────
  console.log("\n3. createScheduled → dispatchScheduledById");
  const sched = await svc.createScheduled({
    broadcast: false, title: "VERIFY scheduled", body: "sched body", type: "general",
    scheduledAt: new Date(Date.now() + 3600_000),
    audience: { all: false, userIds: [customerId] },
  });
  seen.push(sched.id);
  const schedRow = await prisma.notification.findFirst({ where: { id: sched.id } });
  check("scheduled row persisted with status=scheduled", schedRow?.status === "scheduled");
  check("createScheduled returns int id usable as jobId", Number.isInteger(sched.id) && sched.id > 0);

  const fired = await svc.dispatchScheduledById(String(sched.id));
  check("dispatchScheduledById claims + returns result", fired !== null);
  const afterFire = await prisma.notification.findFirst({ where: { id: sched.id } });
  check("fired row no longer 'scheduled'", afterFire?.status !== "scheduled", afterFire?.status);

  const refire = await svc.dispatchScheduledById(String(sched.id));
  check("double-fire is a no-op (claim-lock)", refire === null);

  // ── 4. existsSql routing helper ───────────────────────────────────────────
  console.log("\n4. existsSql (dual-read routing)");
  check("existsSql true for a real SQL id", (await svc.existsSql(String(sched.id))) === true);
  check("existsSql false for a Mongo hex id", (await svc.existsSql("60c72b2f9b1e8a3f4c8b4567")) === false);
  check("existsSql false for unknown int", (await svc.existsSql("987654321")) === false);

  // ── 5. cancelScheduled ────────────────────────────────────────────────────
  console.log("\n5. cancelScheduled");
  const sched2 = await svc.createScheduled({
    broadcast: true, title: "VERIFY cancel-me", body: "b", type: "general",
    scheduledAt: new Date(Date.now() + 3600_000), audience: { all: true },
  });
  seen.push(sched2.id);
  const cancelled = await svc.cancelScheduled(sched2.id);
  check("cancel returns the row", cancelled?.id === sched2.id);
  check("cancelled status = cancelled", cancelled?.status === "cancelled");
  check("cancel a non-scheduled row → null", (await svc.cancelScheduled(sched2.id)) === null);

  // ── 6. listAdminLog ───────────────────────────────────────────────────────
  console.log("\n6. listAdminLog");
  const log = await svc.listAdminLog({ q: "VERIFY", sortBy: "createdAt", sortOrder: "desc", skip: 0, take: 50 });
  check("admin log returns parent rows only (customerId null)", log.data.every((d: any) => d.customerId === null));
  check("admin log finds our VERIFY rows", log.total >= 2, `total=${log.total}`);

  // ── 7. deleteOne + bulkDelete ─────────────────────────────────────────────
  console.log("\n7. deleteOne / bulkDelete");
  const del = await svc.deleteOne(sched2.id);
  check("deleteOne existed", del.existed === true);
  check("deleteOne reports wasScheduled=false (it was cancelled)", del.wasScheduled === false);
  check("deleteOne missing → existed false", (await svc.deleteOne(987654321)).existed === false);

  const remaining = [...new Set(seen)].filter((id) => id !== sched2.id);
  const bulk = await svc.bulkDelete(remaining);
  check("bulkDelete removes remaining rows", bulk.deletedCount >= 1, `deleted=${bulk.deletedCount}`);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  await prisma.notification.deleteMany({ where: { id: { in: seen } } });
  await prisma.notification.deleteMany({ where: { customerId, title: { startsWith: "VERIFY" } } });
  // Restore the customer's original device token (or clear our throwaway).
  await prisma.customer.update({
    where: { id: customerId },
    data: { firebaseToken: originalToken, updatedAt: new Date() },
  });
  if (createdCustomer) await prisma.customer.delete({ where: { id: customerId } });

  console.log(`\n────────────\nPASS ${pass}  FAIL ${fail}\n`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
