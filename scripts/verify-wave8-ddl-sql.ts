/**
 * E2E verification of the Wave 8 DDL batch on SQL: tracking(ActivityLog), goal,
 * cms-extra(SocialLinkType/SocialLink/CurrentAffair/LiveBannerSlider), inquiry,
 * offline Banner. Creates/mutates/deletes its own rows, asserts shape + the FK
 * guards (SocialLinkType in-use 409), then cleans up.
 *
 * Run: npx tsx scripts/verify-wave8-ddl-sql.ts
 */
import "dotenv/config";
import { prisma } from "../src/config/prisma";
import * as track from "../src/modules/tracking/tracking.service";
import * as goal from "../src/modules/goal/goal.service";
import * as cmsx from "../src/modules/cms/cms-extra.service";
import * as inq from "../src/modules/inquiry/inquiry.service";
import * as ob from "../src/modules/offline-batch/offline-batch.service";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label} ${detail}`); }
}

async function main() {
  for (const [n, on] of [["tracking", track.isTrackingMysql()], ["goal", goal.isGoalMysql()], ["cms-extra", cmsx.isCmsExtraMysql()], ["inquiry", inq.isInquiryMysql()], ["offline-batch", ob.isOfflineBatchMysql()]] as const) {
    if (!on) throw new Error(`flag ${n} is OFF`);
  }

  // ── 1. tracking (ActivityLog) ──────────────────────────────────────────────
  console.log("1. tracking / ActivityLog");
  const al = await prisma.activityLog.create({ data: { event: "VERIFY_EVT", customerId: 472335, metadata: { a: 1 } as any, createdAt: new Date() } });
  const lst = await track.listActivity({ event: "VERIFY_EVT", page: 1, limit: 10 });
  check("activity list finds ours", lst.data.some((r: any) => r._id === String(al.id)));
  check("metadata round-trips", lst.data[0]?.metadata?.a === 1);
  const sum = await track.activitySummary({});
  check("summary byEvent includes VERIFY_EVT", sum.byEvent.some((e: any) => e._id === "VERIFY_EVT"));
  check("summary dailyCount has entries", Array.isArray(sum.dailyCount) && sum.dailyCount.length >= 1);
  check("summary uniqueUsers is a number", typeof sum.uniqueUsers === "number");
  await prisma.activityLog.delete({ where: { id: al.id } });

  // ── 2. goal ────────────────────────────────────────────────────────────────
  console.log("\n2. goal");
  const g = await goal.createGoalSql({ title: "VERIFY_Goal", labels: [{ name: "L1" }, { name: "L2" }], image: "http://x/g.png", isActive: true });
  check("goal created with labels JSON", g.labels.length === 2 && g.labels[0].name === "L1");
  const gList = await goal.getGoalsSql({ search: "VERIFY_Goal", page: 1, limit: 10, sortBy: "createdAt", sortOrder: "desc" });
  check("goal search finds ours", gList.data.some((x: any) => x._id === g._id));
  const gU = await goal.updateGoalSql(Number(g._id), { isActive: false });
  check("goal update + previousImage tracked", gU?.goal.isActive === false);
  check("goal delete returns image for cleanup", (await goal.deleteGoalSql(Number(g._id)))?.image === "http://x/g.png");

  // ── 3. cms-extra: SocialLinkType + SocialLink (FK + 409) ──────────────────
  console.log("\n3. cms-extra SocialLink(+Type)");
  const slt = await cmsx.createSocialLinkType({ title: "VERIFY_SLT" });
  const sl = await cmsx.createSocialLink({ typeId: Number(slt._id), title: "VERIFY_SL", link: "https://x.com", order: 2, status: true });
  check("social link created", sl.title === "VERIFY_SL");
  check("social link populates type", sl.typeId?._id === slt._id && sl.typeId?.title === "VERIFY_SLT");
  check("delete type in-use → 409", (await cmsx.deleteSocialLinkType(Number(slt._id))).ok === false);
  check("social link list finds ours", (await cmsx.listSocialLinks()).some((x: any) => x._id === sl._id));
  check("delete social link ok", (await cmsx.deleteSocialLink(Number(sl._id))) === true);
  check("delete type ok once unused", (await cmsx.deleteSocialLinkType(Number(slt._id))).ok === true);

  // ── 4. cms-extra: CurrentAffair ───────────────────────────────────────────
  console.log("\n4. cms-extra CurrentAffair");
  const ca = await cmsx.createCurrentAffair({ title: "VERIFY_CA", image: "http://x/ca.png", youtubeLink: "https://yt/x", status: true });
  check("current affair created", ca.title === "VERIFY_CA" && ca.youtubeLink === "https://yt/x");
  check("ca update ok", (await cmsx.updateCurrentAffair(Number(ca._id), { status: false }))?.status === false);
  check("ca delete ok", (await cmsx.deleteCurrentAffair(Number(ca._id))) === true);

  // ── 5. cms-extra: LiveBannerSlider + reorder ──────────────────────────────
  console.log("\n5. cms-extra LiveBannerSlider");
  const lc = await prisma.liveCourse.findFirst({ select: { id: true } });
  const lb1 = await cmsx.createLiveBanner({ image: "http://x/lb1.png", liveCourseId: lc?.id ?? 1, orderBy: 5 });
  const lb2 = await cmsx.createLiveBanner({ image: "http://x/lb2.png", liveCourseId: lc?.id ?? 1, orderBy: 1 });
  const lbList = await cmsx.listLiveBanners();
  const idx1 = lbList.findIndex((x: any) => x._id === lb2._id);
  const idx2 = lbList.findIndex((x: any) => x._id === lb1._id);
  check("live banners sorted by orderBy (lb2 before lb1)", idx1 < idx2);
  const moved = await cmsx.reorderLiveBanners([{ id: lb1._id, orderBy: 0 }]);
  check("reorder applied", moved === 1);
  check("lb1 orderBy now 0", (await cmsx.getLiveBanner(Number(lb1._id)))?.orderBy === 0);
  await cmsx.deleteLiveBanner(Number(lb1._id));
  await cmsx.deleteLiveBanner(Number(lb2._id));
  check("live banners cleaned", !(await cmsx.listLiveBanners()).some((x: any) => x._id === lb1._id || x._id === lb2._id));

  // ── 6. inquiry (customer populate + submit) ───────────────────────────────
  console.log("\n6. inquiry");
  const sub = await inq.submitInquiry(472335, "VERIFY_inquiry desc");
  check("client submit creates row", sub.description === "VERIFY_inquiry desc");
  const iList = await inq.listInquiries({ search: "VERIFY_inquiry", page: 1, limit: 10 });
  const iRow = iList.data.find((r: any) => r._id === sub._id);
  check("admin list finds ours", !!iRow);
  check("customer populated (object w/ _id)", iRow?.customerId && typeof iRow.customerId === "object" && iRow.customerId._id === "472335");
  check("get inquiry ok", (await inq.getInquiry(Number(sub._id)))?._id === sub._id);
  check("delete inquiry ok", (await inq.deleteInquiry(Number(sub._id))) === true);
  check("delete missing inquiry → false", (await inq.deleteInquiry(999999999)) === false);

  // ── 7. offline Banner (order_by + reorder) ────────────────────────────────
  console.log("\n7. offline Banner");
  const b1 = await ob.createBanner({ image: "http://x/b1.png", orderBy: 9 });
  const b2 = await ob.createBanner({ image: "http://x/b2.png", orderBy: 2 });
  const bList = await ob.listBanners();
  check("banners sorted by orderBy (b2 first)", bList.findIndex((x: any) => x._id === b2._id) < bList.findIndex((x: any) => x._id === b1._id));
  check("banner update ok", (await ob.updateBanner(Number(b1._id), { orderBy: 0 })).ok === true);
  check("reorder applied", (await ob.reorderBanners([{ id: b2._id, orderBy: 1 }])) === 1);
  check("banner delete ok", (await ob.deleteBanner(Number(b1._id))) === true);
  await ob.deleteBanner(Number(b2._id));
  check("banners cleaned", !(await ob.listBanners()).some((x: any) => x._id === b1._id || x._id === b2._id));

  // residue sweep
  const r1 = await prisma.goal.count({ where: { title: "VERIFY_Goal" } });
  const r2 = await prisma.inquiry.count({ where: { description: "VERIFY_inquiry desc" } });
  check("no goal/inquiry residue", r1 === 0 && r2 === 0);

  console.log(`\n────────────\nPASS ${pass}  FAIL ${fail}\n`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
