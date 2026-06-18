/**
 * End-to-end verification of the Wave 8 offline admin CRUD on SQL:
 * Center + Batch (offline-batch module) and Enquiry (offline-enquiry module).
 * Exercises the full FK chain City→Center→Batch→Enquiry, the cascade rules
 * (center-with-batches blocks delete; batch delete cascades enquiries), the
 * JSON images / BigInt phone / status-synth drifts, then cleans up.
 *
 * Run: npx tsx scripts/verify-offline-admin-sql.ts
 */
import "dotenv/config";
import { prisma } from "../src/config/prisma";
import * as ob from "../src/modules/offline-batch/offline-batch.service";
import * as oe from "../src/modules/offline-enquiry/offline-enquiry.service";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label} ${detail}`); }
}

async function main() {
  if (!ob.isOfflineBatchMysql()) throw new Error("flag offline-batch is OFF");
  if (!oe.isOfflineEnquiryMysql()) throw new Error("flag offline-enquiry is OFF");

  const city = await prisma.offlineCity.findFirst({ select: { id: true, name: true }, orderBy: { id: "asc" } });
  if (!city) throw new Error("no OfflineCity to anchor the FK chain");
  console.log(`\nUsing city #${city.id} (${city.name})\n`);

  const ids: { center?: number; batch?: number; enquiry?: number } = {};

  // ── Center create (JSON images + BigInt phone + city populate) ─────────────
  console.log("1. Center CRUD");
  const c = await ob.createCenter({
    name: "VERIFY_Center", images: ["http://x/1.png", "http://x/2.png"], address: "Addr 1",
    latitude: 19.07, longitude: 72.87, phone: "9998887776", cityId: city.id,
  });
  check("center created", c.ok);
  if (c.ok) {
    ids.center = Number(c.data._id);
    check("images[] round-trips from JSON col", Array.isArray(c.data.images) && c.data.images.length === 2, JSON.stringify(c.data.images));
    check("phone serialized as string (BigInt)", c.data.phone === "9998887776");
    check("status synthesized true (no SQL col)", c.data.status === true);
    check("city populated", c.data.city?.name === city.name);
  }
  check("create center w/ missing city → 404", (await ob.createCenter({ name: "x", images: [], address: "a", latitude: 0, longitude: 0, phone: "1", cityId: 999999999 })).ok === false);
  const cU = await ob.updateCenter(ids.center!, { address: "Addr 2", phone: "8887776665" });
  check("center update ok", cU.ok && cU.data.address === "Addr 2" && cU.data.phone === "8887776665");

  // ── Batch create (description→discription, FK to center, center+city pop) ──
  console.log("\n2. Batch CRUD");
  const b = await ob.createBatch({
    name: "VERIFY_Batch", image: "http://x/b.png", description: "Batch desc",
    startAt: new Date(Date.now() + 86400000).toISOString(), duration: "3 months", centerId: ids.center!,
  });
  check("batch created", b.ok);
  if (b.ok) {
    ids.batch = Number(b.data._id);
    check("description maps to discription col", b.data.description === "Batch desc");
    check("batch center→city populated", b.data.center?.city?.name === city.name);
    check("batch status synth true", b.data.status === true);
  }
  check("create batch w/ missing center → 404", (await ob.createBatch({ name: "x", image: "i", description: "d", startAt: new Date().toISOString(), duration: "1m", centerId: 999999999 })).ok === false);
  const bList = await ob.listBatches({ centerId: ids.center });
  check("list batches by center finds ours", bList.some((x: any) => x._id === String(ids.batch)));

  // ── Center delete blocked while it has a batch (409) ──────────────────────
  console.log("\n3. delete guards");
  const blocked = await ob.deleteCenter(ids.center!);
  check("delete center with batches → 409", blocked.ok === false && (blocked as any).status === 409);

  // ── Enquiry create (via service) + admin list + delete ────────────────────
  console.log("\n4. Enquiry admin list + delete");
  const enq = await oe.submitEnquiryMysql({
    customerId: null, name: "VERIFY_Lead", email: "lead@x.com", mobile: "9090909090",
    qualification: "BSc", batchId: ids.batch!,
  } as any);
  ids.enquiry = Number(enq._id);
  const eList = await oe.listEnquiriesAdmin({ batchId: ids.batch, page: 1, limit: 20 });
  const eRow = eList.data.find((r: any) => r._id === String(ids.enquiry));
  check("admin enquiry list finds ours", !!eRow);
  check("enquiry batch populated", eRow?.batchId?.name === "VERIFY_Batch");
  check("enquiry mobile as string", eRow?.mobile === "9090909090");
  check("enquiry search by name", (await oe.listEnquiriesAdmin({ search: "VERIFY_Lead", page: 1, limit: 20 })).data.some((r: any) => r._id === String(ids.enquiry)));
  check("delete missing enquiry → false", (await oe.deleteEnquiryAdmin(999999999)) === false);

  // ── Batch delete cascades enquiries ───────────────────────────────────────
  console.log("\n5. cascade: batch delete removes enquiries");
  const delB = await ob.deleteBatch(ids.batch!);
  check("batch delete ok", delB.ok);
  const orphan = await prisma.offlineEnquiry.count({ where: { id: ids.enquiry! } });
  check("enquiry cascaded away on batch delete", orphan === 0);
  ids.enquiry = undefined; // already gone

  // ── Now center delete succeeds (no batches left) ──────────────────────────
  console.log("\n6. center delete after batches gone");
  const delC = await ob.deleteCenter(ids.center!);
  check("center delete ok once empty", delC.ok);
  ids.center = undefined;

  // ── Cleanup any stragglers ────────────────────────────────────────────────
  if (ids.enquiry) await prisma.offlineEnquiry.deleteMany({ where: { id: ids.enquiry } });
  if (ids.batch) await prisma.offlineBatch.deleteMany({ where: { id: ids.batch } });
  if (ids.center) await prisma.offlineCenter.deleteMany({ where: { id: ids.center } });
  const residue = await prisma.offlineCenter.count({ where: { name: "VERIFY_Center" } });
  check("no center residue", residue === 0);

  console.log(`\n────────────\nPASS ${pass}  FAIL ${fail}\n`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
