import { prisma } from "../src/config/prisma";
import { createVideo } from "../src/modules/admin-video/admin-video.service";
import { createBanner } from "../src/modules/banner-slider/banner-slider.service";
import { createLiveBanner } from "../src/modules/cms/cms-extra.service";
import * as lc from "../src/modules/admin-live-course/admin-live-course.service";

async function main() {
  // ── 1. VIDEO ───────────────────────────────────────────────────────────────
  const cat = await prisma.videoCategory.findFirst({ select: { id: true } });
  if (!cat) throw new Error("no video category to attach to");
  const vMinBefore = (await prisma.video.aggregate({ _min: { order: true } }))._min.order;
  const v = await createVideo({
    videoCategoryId: String(cat.id), name: "order probe", slug: "order-probe-x1",
    topic: "t", type: "free", status: true, youtube: true, youtubeId: "abc123",
  } as any);
  const vRow = await prisma.video.findFirst({ where: { slug: { startsWith: "order-probe-x1" } }, select: { id: true, order: true } });
  console.log(`VIDEO       min before=${vMinBefore} → new order=${vRow?.order} (top? ${vRow!.order < (vMinBefore ?? 0)})`);
  // and it actually sorts first
  const firstVideo = await prisma.video.findFirst({ orderBy: [{ order: "asc" }, { id: "asc" }], select: { id: true } });
  console.log(`            sorts first in list: ${firstVideo?.id === vRow?.id}`);
  await prisma.video.delete({ where: { id: vRow!.id } });

  // ── 2. BANNER (scoped per key) ─────────────────────────────────────────────
  const bMinCourses = (await prisma.bannerSlider.aggregate({ where: { key: "courses" }, _min: { orderBy: true } }))._min.orderBy;
  const b = await createBanner({ image: "https://x/b.png", key: "Courses", keyId: 1 } as any);
  const bRow = await prisma.bannerSlider.findUnique({ where: { id: Number(b._id) }, select: { id: true, orderBy: true, key: true } });
  console.log(`BANNER      min(key=courses) before=${bMinCourses} → new orderBy=${bRow?.orderBy} key=${bRow?.key}`);
  await prisma.bannerSlider.delete({ where: { id: bRow!.id } });

  // ── 3. LIVE BANNER ─────────────────────────────────────────────────────────
  const lbMin = (await prisma.liveBannerSlider.aggregate({ _min: { orderBy: true } }))._min.orderBy;
  const lb = await createLiveBanner({ image: "https://x/lb.png", liveCourseId: 1 });
  const lbRow = await prisma.liveBannerSlider.findUnique({ where: { id: Number(lb._id) }, select: { id: true, orderBy: true } });
  console.log(`LIVEBANNER  min before=${lbMin} → new orderBy=${lbRow?.orderBy}`);
  await prisma.liveBannerSlider.delete({ where: { id: lbRow!.id } });

  // ── 4. LIVE COURSE create + reorder ────────────────────────────────────────
  const lcMin = (await prisma.liveCourse.aggregate({ _min: { ordered: true } }))._min.ordered;
  const made = await lc.createLiveCourse({ name: "order probe LC", description: "d", image: "https://x/i.png", level: "L", status: true });
  const lcId = Number(made.liveCourse._id);
  const lcRow = await prisma.liveCourse.findUnique({ where: { id: lcId }, select: { ordered: true } });
  console.log(`LIVECOURSE  min before=${lcMin} → new ordered=${lcRow?.ordered}`);
  const firstLc = await prisma.liveCourse.findFirst({ orderBy: [{ ordered: "asc" }, { createdAt: "desc" }], select: { id: true } });
  console.log(`            sorts first in list: ${firstLc?.id === lcId}`);

  // reorder: valid ids
  const n = await lc.reorderLiveCourses([{ id: String(lcId), ordered: 7 }]);
  const after = await prisma.liveCourse.findUnique({ where: { id: lcId }, select: { ordered: true } });
  console.log(`REORDER     count=${n} ordered now=${after?.ordered}`);
  // reorder: all-invalid ids → 0 (controller turns this into 400)
  console.log(`REORDER     all-invalid ids → count=${await lc.reorderLiveCourses([{ id: "abc", ordered: 1 }])}`);
  // reorder: atomicity — one bad id in the batch must roll the whole thing back
  const before = (await prisma.liveCourse.findUnique({ where: { id: lcId }, select: { ordered: true } }))!.ordered;
  let threw = false;
  try { await lc.reorderLiveCourses([{ id: String(lcId), ordered: 99 }, { id: "99999999", ordered: 1 }]); } catch { threw = true; }
  const post = (await prisma.liveCourse.findUnique({ where: { id: lcId }, select: { ordered: true } }))!.ordered;
  console.log(`REORDER     batch w/ nonexistent id threw=${threw}, rolled back=${before === post} (${before}→${post})`);

  await prisma.liveCourse.delete({ where: { id: lcId } });
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FAILED:", e.message); await prisma.$disconnect(); process.exit(1); });
