/**
 * Retry contract for scheduled notifications (docs/NOTIFICATION_DEAD_LETTER_QUEUE.md).
 * FCM is stubbed (no real push is sent); the DB is real. Creates one scheduled row a
 * year out (so no worker can fire it), drives dispatchScheduledById through each case,
 * then deletes everything it wrote.
 * Run: npx tsx scripts/verify-notification-retry.ts
 */
import "dotenv/config";
import Module from "module";

type Send = { attempted: number; successCount: number; failureCount: number; invalidTokens: string[]; skipped: boolean };
let nextSend: Send;
const origLoad = (Module as any)._load;
(Module as any)._load = function (request: string, parent: any, ...rest: any[]) {
  if (request.endsWith("/utils/fcm")) return { sendPush: async () => nextSend };
  return origLoad.call(this, request, parent, ...rest);
};

const OUTAGE: Send = { attempted: 1, successCount: 0, failureCount: 1, invalidTokens: [], skipped: false };
const DELIVERED: Send = { attempted: 1, successCount: 1, failureCount: 0, invalidTokens: [], skipped: false };
const NO_DEVICES: Send = { attempted: 0, successCount: 0, failureCount: 0, invalidTokens: [], skipped: false };

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail: unknown = "") => {
  if (cond) pass++; else { fail++; console.log(`  ✗ ${label}`, detail); }
};

async function main() {
  const { prisma } = await import("../src/config/prisma");
  const svc = await import("../src/modules/admin-notification/admin-notification.service");
  const marker = `retry-probe-${Date.now()}`;
  const customer = await prisma.customer.findFirst({
    where: { isAccountDeleted: false, status: true, firebaseToken: { not: null } },
    select: { id: true },
  });
  if (!customer) throw new Error("need one customer with a device token");

  const newRow = async () =>
    (await svc.createScheduled({
      broadcast: false, title: marker, body: "probe", type: "general",
      scheduledAt: new Date(Date.now() + 365 * 86_400_000),
      audience: { all: false, userIds: [String(customer.id)] },
    })).id;
  const statusOf = async (id: number) => (await prisma.notification.findUnique({ where: { id }, select: { status: true, failureReason: true } }))!;

  try {
    // A. Outage on every attempt: each attempt hands the row back, so all 3 BullMQ attempts
    //    really run; then the worker's final-failure listener marks it failed.
    const a = await newRow();
    for (let attempt = 1; attempt <= 3; attempt++) {
      nextSend = OUTAGE;
      const r = await svc.dispatchScheduledById(String(a));
      check(`A attempt ${attempt} ran (not skipped)`, r !== null, r);
      check(`A attempt ${attempt} retryable`, !!r && svc.isRetryableDispatchFailure(r), r);
      check(`A attempt ${attempt} row back to scheduled`, (await statusOf(a)).status === "scheduled");
    }
    await svc.markFailed(String(a), "All sends failed.");
    const af = await statusOf(a);
    check("A final: row failed with reason", af.status === "failed" && af.failureReason === "All sends failed.", af);

    // B. Outage, then FCM recovers: the retry delivers it.
    const b = await newRow();
    nextSend = OUTAGE;
    await svc.dispatchScheduledById(String(b));
    nextSend = DELIVERED;
    const rb = await svc.dispatchScheduledById(String(b));
    check("B retry delivered", rb?.status === "sent" && (await statusOf(b)).status === "sent", rb);
    check("B no further send", (await svc.dispatchScheduledById(String(b))) === null);

    // C. No registered devices: permanent, failed at once, never retried.
    const c = await newRow();
    nextSend = NO_DEVICES;
    const rc = await svc.dispatchScheduledById(String(c));
    check("C failed, not retryable", rc?.status === "failed" && !svc.isRetryableDispatchFailure(rc!), rc);
    check("C row failed immediately", (await statusOf(c)).status === "failed");
    check("C a retry would be a no-op", (await svc.dispatchScheduledById(String(c))) === null);

    // D. Partial delivery is still a success (unchanged behaviour).
    const d = await newRow();
    nextSend = { attempted: 2, successCount: 1, failureCount: 1, invalidTokens: [], skipped: false };
    const rd = await svc.dispatchScheduledById(String(d));
    check("D partial delivery = sent", rd?.status === "sent" && (await statusOf(d)).status === "sent", rd);
  } finally {
    // Parent rows plus the per-recipient feed rows a successful targeted send fans out.
    const { count } = await prisma.notification.deleteMany({ where: { title: marker } });
    console.log(`cleanup: removed ${count} probe rows`);
    await prisma.$disconnect();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
