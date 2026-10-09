/**
 * Read-only check that the batched catalog/package-detail loaders (CODE_QUALITY_AUDIT
 * CQ0.3, CQ1.1, PERF3, PERF6, PERF7, PERF9) return the same output as the old per-row queries.
 * Run: npx tsx scripts/verify-catalog-batching.ts
 */
import "dotenv/config";
import { prisma } from "../src/config/prisma";
import { descendantsOf, selfFkDescendantsByRoot } from "../src/modules/catalog-category-tree/category-tree.service";
import { buildPackageDetailShared, enrichPackagesSql } from "../src/modules/catalog-package/catalog-package.detail.sql";
import { listActivePricesByPackage } from "../src/modules/commerce-price/commerce-price.service";
import { fetchTrendingEbooksOnly } from "../src/modules/client-trending/client-trending.service";
import { getCategoryChildren as materialChildren } from "../src/modules/catalog-material/catalog-material.service";
import { getCategoryChildren as examChildren } from "../src/modules/catalog-exam/catalog-exam.service";
import { getVideoCategoryChildren } from "../src/modules/catalog-video/catalog-video.service";
import { examInCategoryWhere } from "../src/modules/catalog-exam/exam-category-pivot.where";
import { getCategoryContents } from "../src/modules/client-material/client-material.service";
import { catalogMaterials, catalogTests } from "../src/modules/client-catalog/client-catalog.service";
import { examInCategoriesWhere, subjectStartedWhere } from "../src/modules/catalog-exam/exam-category-pivot.where";
import { getActivePackageSubscription, getActivePackageSubMap } from "../src/modules/commerce-subscription/commerce-subscription.service";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = "") => {
  if (cond) pass++;
  else { fail++; console.log(`  ✗ ${label} ${detail}`); }
};

// The pre-batching walk, kept verbatim as the oracle.
const oldDescendants = async (table: string, col: string, root: number) =>
  (await prisma.$queryRawUnsafe<{ id: number }[]>(
    `WITH RECURSIVE tree (id) AS (SELECT ${root} UNION SELECT c.id FROM ${table} c JOIN tree t ON c.${col} = t.id) SELECT id FROM tree`
  )).map((r) => Number(r.id));

const sameSet = (a: number[], b: number[]) => a.length === b.length && a.every((x) => b.includes(x));

async function main() {
  const pkgs = await prisma.package.findMany({ select: { id: true }, orderBy: { id: "desc" }, take: 30 });
  for (const { id } of pkgs) {
    const shared = await buildPackageDetailShared(id);
    if (!shared) continue;

    for (const g of shared.videos) {
      const cid = Number(g.category._id);
      const sub = await descendantsOf([cid]);
      const count = await prisma.video.count({ where: { videoCategoryId: { in: sub }, status: true } });
      const edges = await prisma.videoCategoryRelation.count({ where: { parent: cid } });
      check(`pkg ${id} video ${cid}`, g.category.count === count && g.category.havingChildDirectory === edges > 0, `${g.category.count} vs ${count}`);
    }
    for (const g of shared.materials) {
      const cid = Number(g.category._id);
      const sub = await oldDescendants("ws_material_category", "parent", cid);
      const newSub = (await selfFkDescendantsByRoot("ws_material_category", "parent", [cid])).get(cid) ?? [];
      check(`material subtree ${cid}`, sameSet(sub, newSub));
      const count = await prisma.material.count({ where: { materialCategoryId: { in: sub }, status: true } });
      const kids = await prisma.materialCategory.count({ where: { parent: cid, status: true } });
      check(`pkg ${id} material ${cid}`, g.category.count === count && g.category.havingChildDirectory === kids > 0, `${g.category.count} vs ${count}`);
    }
    for (const g of shared.tests) {
      const cid = Number(g.category._id);
      const sub = await oldDescendants("ws_exam_category", "parent_id", cid);
      const count = await prisma.exam.count({ where: { AND: [examInCategoriesWhere(sub), { status: true }] } });
      check(`pkg ${id} exam ${cid}`, g.category.count === count, `${g.category.count} vs ${count}`);
    }

    const mats = await catalogMaterials({ type: "package", id, search: null });
    for (const g of mats.list as any[]) {
      const cid = Number(g.category._id);
      const sub = await oldDescendants("ws_material_category", "parent", cid);
      const items = await prisma.material.count({ where: { materialCategoryId: { in: sub }, status: true } });
      const kids = (await prisma.materialCategory.findMany({ where: { parent: cid, status: true }, select: { id: true } })).map((c) => String(c.id));
      check(`catalog material ${cid} children`, JSON.stringify(g.category.childCategoryIds) === JSON.stringify(kids));
      check(`catalog material ${cid} count`, g.category.count === (kids.length ? kids.length : items));
    }
    const tests = await catalogTests({ type: "package", id, search: null });
    for (const g of tests.list as any[]) {
      const cid = Number(g.category._id);
      const sub = await oldDescendants("ws_exam_category", "parent_id", cid);
      const items = await prisma.exam.count({ where: { AND: [examInCategoriesWhere(sub), { status: true, type: "subject" }, subjectStartedWhere(new Date())] } });
      const kids = await prisma.examCategory.count({ where: { parent: cid, status: true } });
      check(`catalog exam ${cid} count`, g.category.count === (kids ? kids : items));
    }
  }

  // Package list purchase state: batch map vs the old per-row lookup.
  const subs = await prisma.packageCourseSubscription.findMany({ where: { status: true, endAt: { gt: new Date() }, packageId: { not: null } }, select: { customerId: true }, take: 10 });
  const pkgIds = pkgs.map((p) => p.id);
  for (const { customerId } of subs) {
    if (customerId == null) continue;
    const now = new Date();
    const map = await getActivePackageSubMap(customerId, pkgIds, now);
    for (const pid of pkgIds) {
      const one = await getActivePackageSubscription(customerId, pid, now);
      check(`customer ${customerId} pkg ${pid}`, !!one === map.has(pid) && (!one || +(one.endAt ?? 0) === +(map.get(pid) ?? 0)));
    }
  }

  // PERF6: package list enrichment vs the old per-row plans / subscriber count / type / goal.
  const pkgRows = await prisma.package.findMany({ orderBy: { id: "desc" }, take: 30 });
  const enriched = await enrichPackagesSql(pkgRows, null);
  for (const [i, p] of pkgRows.entries()) {
    const e = enriched[i];
    const plans = await listActivePricesByPackage(p.id);
    const subs = await prisma.packageCourseSubscription.count({ where: { packageId: p.id, status: true } });
    const type = p.packageTypeId != null ? await prisma.packageType.findUnique({ where: { id: p.packageTypeId }, select: { id: true, name: true } }) : null;
    const goal = p.goalId != null ? await prisma.customerTargetGoal.findUnique({ where: { id: p.goalId }, select: { id: true, name: true } }) : null;
    check(`pkg list ${p.id} plans`, JSON.stringify(e.plans) === JSON.stringify({ withMaterial: plans.filter((x) => x.withMaterial), withoutMaterial: plans.filter((x) => !x.withMaterial) }));
    check(`pkg list ${p.id} subs`, e.subscriberCount === subs, `${e.subscriberCount} vs ${subs}`);
    check(`pkg list ${p.id} type/goal`, JSON.stringify(e.packageTypeId) === JSON.stringify(type ? { _id: String(type.id), name: type.name } : null) && JSON.stringify(e.goalId) === JSON.stringify(goal ? { _id: String(goal.id), title: goal.name } : null));
  }

  // PERF7: trending ebooks free/paid in SQL vs the old load-all + min-plan-price filter.
  const allTrending = await prisma.eBook.findMany({ where: { active: true, isTrending: true }, orderBy: [{ orderby: "asc" }, { createdAt: "asc" }] });
  const tPlans = await prisma.packageCourseEbookPrice.findMany({ where: { ebookId: { in: allTrending.map((e) => e.id) }, status: true } });
  const minPrice = (id: number) => { const ps = tPlans.filter((x) => x.ebookId === id).map((x) => Number(x.price) || 0); return ps.length ? Math.min(...ps) : 0; };
  for (const type of ["free", "paid"] as const) {
    const want = allTrending.filter((e) => (minPrice(e.id) === 0) === (type === "free")).map((e) => String(e.id));
    const got = await fetchTrendingEbooksOnly({ type, limit: 100 });
    check(`trending ebooks ${type} total`, got.total === want.length, `${got.total} vs ${want.length}`);
    check(`trending ebooks ${type} ids`, JSON.stringify(got.items.map((x: any) => x._id)) === JSON.stringify(want.slice(0, 100)));
  }

  // PERF9: /children counts vs the old per-child counts.
  const matParents = await prisma.materialCategory.findMany({ where: { status: true, parent: { gt: 0 } }, distinct: ["parent"], select: { parent: true }, take: 10 });
  for (const { parent } of matParents) {
    const r = await materialChildren(parent);
    for (const g of r?.list ?? []) {
      const n = await prisma.material.count({ where: { materialCategoryId: Number(g.category._id), status: true } });
      check(`material child ${g.category._id}`, g.category.count === n, `${g.category.count} vs ${n}`);
    }
  }
  const examParents = await prisma.examCategory.findMany({ where: { status: true, parent: { gt: 0 } }, distinct: ["parent"], select: { parent: true }, take: 10 });
  for (const { parent } of examParents) {
    const r = await examChildren(parent);
    for (const g of r?.list ?? []) {
      const cid = Number(g.category._id);
      const kids = await prisma.examCategory.count({ where: { parent: cid, status: true } });
      const n = kids || await prisma.exam.count({ where: { AND: [examInCategoryWhere(cid), { status: true, type: "subject" }, subjectStartedWhere(new Date())] } });
      check(`exam child ${cid}`, g.category.count === n, `${g.category.count} vs ${n}`);
    }
  }
  const vidParents = await prisma.videoCategoryRelation.findMany({ distinct: ["parent"], select: { parent: true }, take: 10 });
  for (const { parent } of vidParents) {
    const r = await getVideoCategoryChildren(parent);
    for (const g of r?.list ?? []) {
      if (g.category.havingChildDirectory) continue;
      const n = await prisma.video.count({ where: { videoCategoryId: Number(g.category._id), status: true } });
      check(`video child ${g.category._id}`, g.category.count === n, `${g.category.count} vs ${n}`);
    }
  }

  // client-material folder contents: batched subject counts vs the old per-child queries.
  const cutoff = new Date(Date.now() - 10 * 86_400_000);
  const matCats = await prisma.materialCategory.findMany({ where: { status: true }, select: { id: true }, take: 200 });
  for (const { id } of matCats) {
    const r: any = await getCategoryContents(id, null, { skip: 0, take: 1 });
    for (const sub of r?.subjects ?? []) {
      const cid = Number(sub._id);
      const tree = await oldDescendants("ws_material_category", "parent", cid);
      const n = await prisma.material.count({ where: { materialCategoryId: { in: tree }, status: true } });
      const fresh = await prisma.material.count({ where: { materialCategoryId: { in: tree }, status: true, created_at: { gt: cutoff } } });
      const kids = await prisma.materialCategory.count({ where: { parent: cid, status: true } });
      check(`material subject ${cid}`, sub.count === n && sub.isNewlyAdded === fresh > 0 && sub.havingChildDirectory === kids > 0, { got: sub, n, fresh, kids });
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
