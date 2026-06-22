/*
 * Backfill Mongo `ws_promo_codes` (PromoCode model, C5 appliesTo schema) → SQL
 * `ws_promo_code` (Prisma `PromoCodeRule`).
 *
 * Field map (Mongo doc casing → SQL):
 *   type, promocode, title, description, status, discountType, discountValue,
 *   promo_start_at→promoStartAt, promo_expire_at→promoExpireAt, createdAt, updatedAt.
 *
 * EXTERNAL refs are ObjectIds and there is NO stored Mongo→SQL id map, so (per
 * backfill-c4-wishlist) we bridge by NATURAL KEY and SKIP what can't be mapped —
 * never guess:
 *   - promoterId  → ws_promoter by email, then phone (optional → null if unmapped)
 *   - appliesTo.ids → ws_<entity> by name/title, per appliesTo.type. If ANY id
 *     fails to map the whole appliesTo is dropped to null (a partial coverage set
 *     would silently change who the promo applies to — safer to leave unset).
 *
 * Idempotent: keyed on the unique `promocode` (upper-cased). Re-runs skip existing.
 *
 * Run: DATABASE_URL='...' MONGODB_URI='...' npx tsx scripts/backfill-promo-code.ts
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import { prisma } from "../src/config/prisma";
import { PromoCode } from "../src/models/course/PromoCode.model";

dotenv.config();

type AppliesToType = "package" | "course" | "liveCourse" | "ebook" | "testSeries";

(async () => {
  await mongoose.connect(process.env.MONGODB_URI as string, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db!;

  // ── promoter natural-key bridge (email → id, phone → id) ─────────────────────
  const promoters = await prisma.promoter.findMany({ select: { id: true, email: true, phone: true } });
  const promoterByEmail = new Map(
    promoters.filter((p) => p.email).map((p) => [p.email!.trim().toLowerCase(), p.id])
  );
  const promoterByPhone = new Map(
    promoters.filter((p) => p.phone).map((p) => [p.phone!.trim(), p.id])
  );

  const resolvePromoter = async (mongoId: any): Promise<number | null> => {
    if (!mongoId) return null;
    const doc: any = await db
      .collection("ws_promoters")
      .findOne({ _id: new mongoose.Types.ObjectId(String(mongoId)) }, { projection: { email: 1, phone: 1 } });
    if (!doc) return null;
    const byEmail = doc.email ? promoterByEmail.get(String(doc.email).trim().toLowerCase()) : undefined;
    if (byEmail != null) return byEmail;
    const byPhone = doc.phone ? promoterByPhone.get(String(doc.phone).trim()) : undefined;
    return byPhone ?? null;
  };

  // ── appliesTo entity natural-key maps (name/title → SQL id), per type ────────
  const nameMap = (rows: { id: number; name: string | null }[]) =>
    new Map(rows.filter((r) => r.name).map((r) => [r.name!.trim(), r.id]));
  const sqlEntityMap: Record<AppliesToType, Map<string, number>> = {
    package: nameMap(await prisma.package.findMany({ select: { id: true, name: true } })),
    course: nameMap(await prisma.course.findMany({ select: { id: true, name: true } })),
    liveCourse: nameMap(await prisma.liveCourse.findMany({ select: { id: true, name: true } })),
    ebook: nameMap(await prisma.eBook.findMany({ select: { id: true, name: true } })),
    testSeries: nameMap(
      (await prisma.testSeries.findMany({ select: { id: true, title: true } })).map((r) => ({
        id: r.id,
        name: r.title,
      }))
    ),
  };
  const mongoEntityCollection: Record<AppliesToType, string> = {
    package: "ws_packages",
    course: "ws_courses",
    liveCourse: "ws_live_courses",
    ebook: "ws_ebooks",
    testSeries: "ws_test_series",
  };

  const resolveAppliesTo = async (
    type: AppliesToType,
    ids: any[]
  ): Promise<{ ids: number[]; mapped: boolean }> => {
    const out: number[] = [];
    for (const id of ids) {
      const doc: any = await db
        .collection(mongoEntityCollection[type])
        .findOne({ _id: new mongoose.Types.ObjectId(String(id)) }, { projection: { name: 1, title: 1 } });
      const key = doc ? String(doc.name ?? doc.title ?? "").trim() : "";
      const sqlId = key ? sqlEntityMap[type].get(key) : undefined;
      if (sqlId == null) return { ids: [], mapped: false }; // all-or-nothing
      out.push(sqlId);
    }
    return { ids: [...new Set(out)], mapped: true };
  };

  // ── migrate ──────────────────────────────────────────────────────────────────
  const docs: any[] = await PromoCode.find({}).lean();
  let inserted = 0,
    skippedExisting = 0,
    promoterDropped = 0,
    appliesToDropped = 0;

  for (const d of docs) {
    const code = String(d.promocode || "").toUpperCase().trim();
    if (!code) continue;

    const existing = await prisma.promoCodeRule.findFirst({ where: { promocode: code }, select: { id: true } });
    if (existing) {
      skippedExisting++;
      continue;
    }

    const promoterId = await resolvePromoter(d.promoterId);
    if (d.promoterId && promoterId == null) promoterDropped++;

    let appliesToType: AppliesToType | null = null;
    let appliesToIds: number[] | null = null;
    if (d.appliesTo?.type && Array.isArray(d.appliesTo?.ids) && d.appliesTo.ids.length) {
      const r = await resolveAppliesTo(d.appliesTo.type, d.appliesTo.ids);
      if (r.mapped) {
        appliesToType = d.appliesTo.type;
        appliesToIds = r.ids;
      } else {
        appliesToDropped++;
      }
    }

    await prisma.promoCodeRule.create({
      data: {
        type: d.type ?? "public",
        promocode: code,
        title: d.title ?? "",
        description: d.description ?? "",
        promoStartAt: d.promo_start_at ?? null,
        promoExpireAt: d.promo_expire_at ?? null,
        status: d.status ?? true,
        discountType: d.discountType ?? "percentage",
        discountValue: Number(d.discountValue ?? 0),
        promoterId,
        appliesToType,
        appliesToIds: appliesToIds ?? undefined,
        createdAt: d.createdAt ?? null,
        updatedAt: d.updatedAt ?? null,
      },
    });
    inserted++;
  }

  console.log(
    `promo-code: inserted=${inserted} skippedExisting=${skippedExisting} ` +
      `promoterRefDropped=${promoterDropped} appliesToDropped=${appliesToDropped} (mongo total ${docs.length})`
  );

  await mongoose.disconnect();
  await prisma.$disconnect();
  process.exit(0);
})();
