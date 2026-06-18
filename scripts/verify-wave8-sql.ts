/**
 * End-to-end verification of the Wave 8 zero-DDL SQL slices:
 *  - customer-master (State / District / Education / TargetGoal CRUD + FK + populate)
 *  - ImageNotification CRUD
 * Creates + mutates + deletes its own rows against the real staging DB, asserts
 * shape/behaviour, cleans up. Run: npx tsx scripts/verify-wave8-sql.ts
 */
import "dotenv/config";
import { prisma } from "../src/config/prisma";
import * as cm from "../src/modules/customer-master/customer-master.service";
import * as img from "../src/modules/admin-notification/admin-notification.service";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label} ${detail}`); }
}

async function main() {
  if (!cm.isCustomerMasterMysql()) throw new Error("flag customer-master is OFF");
  if (!img.isAdminNotificationMysql()) throw new Error("flag client-notification is OFF");

  const created: { state?: number; district?: number; edu?: number; goal?: number; image?: number } = {};

  // ── customer-master: State ─────────────────────────────────────────────────
  console.log("1. State CRUD");
  const st = await cm.createState({ name: "VERIFY_State", stateCode: "VZ", active: true });
  created.state = Number(st._id);
  check("state created with _id", st._id != null && st.name === "VERIFY_State");
  check("stateCode mapped (state_code)", st.stateCode === "VZ");
  const stU = await cm.updateState(created.state, { active: false });
  check("state update ok", stU.ok && stU.data.active === false);
  const stList = await cm.listStates(false);
  check("list filters active=false includes ours", stList.some((s: any) => s._id === st._id));
  check("update missing state → 404", (await cm.updateState(999999999, { name: "x" })).ok === false);

  // ── District (FK to State + populate) ──────────────────────────────────────
  console.log("\n2. District CRUD (FK + populate)");
  const di = await cm.createDistrict({ name: "VERIFY_Dist", stateId: created.state!, active: true });
  check("district created", di.ok);
  if (di.ok) {
    created.district = Number(di.data._id);
    check("populated state object (stateId.name)", di.data.stateId?.name === "VERIFY_State");
    check("populated stateCode", di.data.stateId?.stateCode === "VZ");
  }
  check("create district w/ missing state → 404", (await cm.createDistrict({ name: "x", stateId: 999999999, active: true })).ok === false);
  const diList = await cm.listDistricts({ stateId: created.state });
  check("list districts by stateId finds ours", diList.some((d: any) => d._id === String(created.district)));

  // ── Education ──────────────────────────────────────────────────────────────
  console.log("\n3. Education CRUD");
  const ed = await cm.createEducation({ name: "VERIFY_Edu", status: true });
  created.edu = Number(ed._id);
  check("education created (status field)", ed.status === true && ed.name === "VERIFY_Edu");

  // ── TargetGoal (required image defaulted) ──────────────────────────────────
  console.log("\n4. TargetGoal CRUD");
  const go = await cm.createTargetGoal({ name: "VERIFY_Goal", image: "http://x/y.png", active: true });
  created.goal = Number(go._id);
  check("goal created with image", go.image === "http://x/y.png" && go.active === true);

  // ── ImageNotification ──────────────────────────────────────────────────────
  console.log("\n5. ImageNotification CRUD");
  const im = await img.createImageNotification({ image: "http://x/banner.png", redirectUrl: "http://x/go", active: true });
  created.image = Number(im._id);
  check("image created with _id + redirectUrl mapped", im._id != null && im.redirectUrl === "http://x/go");
  const imU = await img.updateImageNotification(created.image, { active: false });
  check("image update ok (active=false)", imU?.active === false);
  const imList = await img.listImageNotifications();
  check("image list (id desc) includes ours", imList.some((r: any) => r._id === im._id));
  check("update missing image → null", (await img.updateImageNotification(999999999, { active: true })) === null);

  // ── Deletes (cleanup + assertions) ─────────────────────────────────────────
  console.log("\n6. deletes");
  check("delete district ok", (await cm.deleteDistrict(created.district!)).ok);
  check("delete state ok", (await cm.deleteState(created.state!)).ok);
  check("delete education ok", (await cm.deleteEducation(created.edu!)).ok);
  check("delete goal ok", (await cm.deleteTargetGoal(created.goal!)).ok);
  check("delete image ok", (await img.deleteImageNotification(created.image!)) === true);
  check("delete missing state → 404", (await cm.deleteState(999999999)).ok === false);

  // residue check
  const leftState = await prisma.customerState.count({ where: { name: "VERIFY_State" } });
  const leftImg = await prisma.imageNotification.count({ where: { image: "http://x/banner.png" } });
  check("no residue (state)", leftState === 0);
  check("no residue (image)", leftImg === 0);

  console.log(`\n────────────\nPASS ${pass}  FAIL ${fail}\n`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
