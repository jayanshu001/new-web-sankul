import { prisma } from "./src/config/prisma";
import { updatePackage } from "./src/modules/admin-package/admin-package.service";
async function main() {
  const pkg = await prisma.package.findFirst({ select: { id: true, packageTypeId: true } });
  const type = await prisma.packageType.findFirst({ select: { id: true } });
  if (!pkg || !type) { console.log("no package/type"); return; }
  const orig = pkg.packageTypeId;
  console.log(`pkg ${pkg.id} orig=${orig}; valid type=${type.id}`);
  try { await updatePackage(pkg.id, { packageTypeId: "999999" }); console.log("BAD: no throw non-existent"); }
  catch (e: any) { console.log("non-existent →", e.statusCode, e.message); }
  try { await updatePackage(pkg.id, { packageTypeId: "abc" }); console.log("BAD: no throw non-numeric"); }
  catch (e: any) { console.log("non-numeric →", e.statusCode, e.message); }
  await updatePackage(pkg.id, { packageTypeId: String(type.id) });
  console.log("valid set →", (await prisma.package.findUnique({ where: { id: pkg.id }, select: { packageTypeId: true } }))?.packageTypeId);
  await updatePackage(pkg.id, { packageTypeId: null });
  console.log("null clear →", (await prisma.package.findUnique({ where: { id: pkg.id }, select: { packageTypeId: true } }))?.packageTypeId);
  await prisma.package.update({ where: { id: pkg.id }, data: { packageTypeId: orig } });
  console.log("restored to", orig);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
