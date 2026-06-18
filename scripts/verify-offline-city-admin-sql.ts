/**
 * E2E verification of the Wave 8 offline CITY admin CRUD on SQL (offline-city).
 * Creates/mutates/deletes its own city, asserts shape + the center-guard 409,
 * cleans up. Run: npx tsx scripts/verify-offline-city-admin-sql.ts
 */
import "dotenv/config";
import { prisma } from "../src/config/prisma";
import * as oc from "../src/modules/offline-city/offline-city.service";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label} ${detail}`); }
}

async function main() {
  if (!oc.isOfflineCityMysql()) throw new Error("flag offline-city is OFF");

  let cityId: number | undefined;
  console.log("\n1. City CRUD");
  const c = await oc.createCityAdmin({ name: "VERIFY_City", image: "http://x/c.png", order: 7, status: true });
  cityId = Number(c._id);
  check("city created with _id", c._id != null && c.name === "VERIFY_City");
  check("order persisted", c.order === 7);
  check("status persisted", c.status === true);

  const got = await oc.getCityAdmin(cityId);
  check("getCityAdmin returns it", got?._id === c._id);
  check("getCityAdmin missing → null", (await oc.getCityAdmin(999999999)) === null);

  const u = await oc.updateCityAdmin(cityId, { name: "VERIFY_City2", status: false });
  check("update ok", u.ok && u.data.name === "VERIFY_City2" && u.data.status === false);
  check("update missing → 404", (await oc.updateCityAdmin(999999999, { name: "x" })).ok === false);

  const listAll = await oc.listCitiesAdmin();
  check("admin list (incl inactive) finds ours", listAll.some((x) => x._id === c._id));
  const listInactive = await oc.listCitiesAdmin(false);
  check("status=false filter includes our (now inactive) city", listInactive.some((x) => x._id === c._id));
  const listActive = await oc.listCitiesAdmin(true);
  check("status=true filter EXCLUDES our inactive city", !listActive.some((x) => x._id === c._id));

  console.log("\n2. delete guard (center FK)");
  // Attach a center to prove the 409 guard, then remove it.
  const center = await prisma.offlineCenter.create({
    data: { name: "VERIFY_C_forCity", image: [] as any, address: "a", latitude: 0, longitude: 0, phone: BigInt(1), cityId, createdAt: new Date(), updatedAt: new Date() },
    select: { id: true },
  });
  const blocked = await oc.deleteCityAdmin(cityId);
  check("delete city with centers → 409", blocked.ok === false && (blocked as any).status === 409);
  await prisma.offlineCenter.delete({ where: { id: center.id } });

  const del = await oc.deleteCityAdmin(cityId);
  check("delete ok once no centers", del.ok);
  check("delete missing → 404", (await oc.deleteCityAdmin(999999999)).ok === false);
  cityId = undefined;

  const residue = await prisma.offlineCity.count({ where: { name: { startsWith: "VERIFY_City" } } });
  check("no city residue", residue === 0);

  console.log(`\n────────────\nPASS ${pass}  FAIL ${fail}\n`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
