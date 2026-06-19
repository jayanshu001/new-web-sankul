/*
 * Backfill Mongo `ws_wishlists` → SQL `ws_wishlist` (C4).
 *
 * The Mongo wishlist stores customerId + itemId as ObjectIds; SQL needs ints.
 * There is NO stored Mongo→SQL id map (the two datasets are largely DISJOINT in
 * staging — see backfill-package-category-link), so we join by NATURAL KEY:
 *   customer → ws_customer.phone   (Mongo Customer.phoneNumber)
 *   item     → ws_<entity>.name    (Mongo entity name/title, per itemType)
 * Rows that don't map are SKIPPED (never guessed). Idempotent: the UNIQUE
 * (customer_id,item_type,item_id) makes re-runs a no-op (P2002 → skip).
 *
 * Run: DATABASE_URL='...' MONGODB_URI='...' npx tsx scripts/backfill-c4-wishlist.ts
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import { prisma } from "../src/config/prisma";
import { Wishlist } from "../src/models/customer/Wishlist.model";
import { Customer } from "../src/models/customer/Customer.model";
import { Course } from "../src/models/course/Course.model";
import { Package } from "../src/models/course/Package.model";
import { Ebook } from "../src/models/ebook/Ebook.model";
import { Book } from "../src/models/book/Book.model";

dotenv.config();

(async () => {
  await mongoose.connect(process.env.MONGODB_URI as string, { serverSelectionTimeoutMS: 10000 });

  // SQL natural-key maps (name → id).
  const custByPhone = new Map(
    (await prisma.customer.findMany({ select: { id: true, phoneNumber: true } }))
      .filter((c) => c.phoneNumber)
      .map((c) => [c.phoneNumber, c.id])
  );
  const nameMap = async (rows: { id: number; name: string | null }[]) =>
    new Map(rows.filter((r) => r.name).map((r) => [r.name!.trim(), r.id]));
  const sqlMapFor: Record<string, Map<string, number>> = {
    course: await nameMap(await prisma.course.findMany({ select: { id: true, name: true } })),
    package: await nameMap(await prisma.package.findMany({ select: { id: true, name: true } })),
    ebook: await nameMap(await prisma.eBook.findMany({ select: { id: true, name: true } })),
    book: await nameMap(await prisma.book.findMany({ select: { id: true, name: true } })),
  };

  const mongoModel: Record<string, any> = { course: Course, package: Package, ebook: Ebook, book: Book };
  const mongoItemName = async (type: string, id: any): Promise<string | null> => {
    const M = mongoModel[type];
    if (!M) return null;
    const doc: any = await M.findById(id).select("name title").lean();
    return doc ? (String(doc.name ?? doc.title ?? "").trim() || null) : null;
  };

  const entries: any[] = await Wishlist.find({}).lean();
  let inserted = 0, skipped = 0;
  for (const w of entries) {
    const cust: any = await Customer.findById(w.customerId).select("phoneNumber").lean();
    const sqlCust = cust?.phoneNumber ? custByPhone.get(cust.phoneNumber) : undefined;
    const name = await mongoItemName(w.itemType, w.itemId);
    const sqlItem = name ? sqlMapFor[w.itemType]?.get(name) : undefined;
    if (!sqlCust || !sqlItem) { skipped++; continue; }
    try {
      await prisma.wishlist.create({
        data: { customerId: sqlCust, itemType: w.itemType, itemId: sqlItem, createdAt: w.createdAt ?? null, updatedAt: w.updatedAt ?? null },
      });
      inserted++;
    } catch (e: any) {
      if (e?.code === "P2002") skipped++; // already present
      else throw e;
    }
  }
  console.log(`wishlist: inserted=${inserted} skipped=${skipped} (mongo total ${entries.length})`);

  await mongoose.disconnect();
  await prisma.$disconnect();
  process.exit(0);
})();
