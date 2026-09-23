/**
 * E2E verification of the SQL VideoCategory DAG resolver
 * (src/modules/catalog-category-tree). Read-only — uses real staging DAG data.
 * Run: npx tsx scripts/verify-category-tree-sql.ts
 */
import "dotenv/config";
import { prisma } from "../src/config/prisma";
import * as ct from "../src/modules/catalog-category-tree/category-tree.service";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label} ${detail}`); }
}

async function main() {
  console.log("\n1. descendantsOf (DOWN-walk, recursive CTE)");
  // Find a real parent with children from the edge table.
  const edge = await prisma.videoCategoryRelation.findFirst({ orderBy: { id: "asc" }, select: { parent: true, child: true } });
  if (!edge) throw new Error("no relation edges in DB");
  const parent = edge.parent;
  const directChildren = (await prisma.videoCategoryRelation.findMany({ where: { parent }, select: { child: true } })).map((r) => r.child);
  const desc = await ct.descendantsOf([parent]);
  check("includes the root itself", desc.includes(parent));
  check("includes all direct children", directChildren.every((c) => desc.includes(c)), `children=${directChildren} got=${desc}`);
  check("result is deduped", desc.length === new Set(desc).size);

  // Multi-level: if any child has its own children, they must appear too.
  let grandchild: number | null = null;
  for (const c of directChildren) {
    const gk = await prisma.videoCategoryRelation.findFirst({ where: { parent: c }, select: { child: true } });
    if (gk) { grandchild = gk.child; break; }
  }
  if (grandchild != null) check("multi-level: grandchild reached", desc.includes(grandchild), `gc=${grandchild}`);
  else check("(no grandchildren in this subtree — skip multi-level)", true);

  console.log("\n2. ancestorsOf (UP-walk)");
  const child = directChildren[0];
  const anc = await ct.ancestorsOf([child]);
  check("includes the leaf itself", anc.includes(child));
  check("includes the parent", anc.includes(parent), `parent=${parent} got=${anc}`);

  console.log("\n3. reachableCategoryIds(course)");
  const course = await prisma.course.findFirst({ where: { status: true, videoCategoryId: { not: null } }, select: { id: true, videoCategoryId: true } });
  if (course) {
    const reach = await ct.reachableCategoryIds("course", course.id);
    check("reachable includes the course's root category", reach.has(course.videoCategoryId!));
    check("reachable ⊇ descendantsOf(root)", (await ct.descendantsOf([course.videoCategoryId!])).every((id) => reach.has(id)));
  } else check("(no course with videoCategoryId — skip)", true);

  console.log("\n4. reachableCategoryIds(package)");
  const pss = await prisma.packageSpecificSubject.findFirst({ where: { status: true, subjectId: { not: null } }, select: { packageId: true, subjectId: true } });
  if (pss?.packageId) {
    const reach = await ct.reachableCategoryIds("package", pss.packageId);
    check("package reachable includes a specific-subject root", reach.has(pss.subjectId!));
  } else check("(no package specific-subject — skip)", true);

  console.log("\n5. resolveVideoScope / resolveVideoCourseId");
  if (course?.videoCategoryId) {
    const scope = await ct.resolveVideoScope(course.videoCategoryId);
    check("resolveVideoScope(root) → course", scope?.kind === "course" && scope.id === String(course.id), JSON.stringify(scope));
    const cid = await ct.resolveVideoCourseId(course.videoCategoryId);
    check("resolveVideoCourseId(root) → course id", cid === course.id, `got=${cid}`);
  } else check("(no course — skip scope)", true);
  check("resolveVideoScope(null) → null", (await ct.resolveVideoScope(null)) === null);
  check("descendantsOf([]) → []", (await ct.descendantsOf([])).length === 0);

  console.log(`\n────────────\nPASS ${pass}  FAIL ${fail}\n`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
