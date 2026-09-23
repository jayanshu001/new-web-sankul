/*
 * Backfill for the 2026-07-08 promocode merge: copy every ws_promo_code
 * (PromoCodeRule) row into ws_promocode (Promocode), then remap
 * ws_promoted_package_course_ebook.promocode_id from the old rule id to the new
 * ws_promocode id so the per-plan promoter/customer % links stay attached.
 *
 * Order (see docs/migration/schema-changes/2026-07-08_merge_promo_code_into_promocode.sql):
 *   1) apply the ADD-COLUMN DDL   2) prisma:generate   3) deploy re-pointed code
 *   4) RUN THIS SCRIPT            5) verify             6) apply the DROP DDL
 *
 *   npx tsx scripts/backfill-merge-promo-code.ts
 *
 * Notes:
 *   - ws_promo_code is read via raw SQL (the PromoCodeRule Prisma model is gone).
 *   - Dedup by `promocode` string: if a ws_promocode row with the same code
 *     already exists, we reuse it (map old->existing) instead of inserting a dup.
 *   - Plan-link remap is safe because promo-code.service is the ONLY SQL writer of
 *     ws_promoted_package_course_ebook rows, so every promocode_id in that table
 *     that equals an old rule id belongs to a migrated code. A two-phase offset
 *     update avoids any mid-remap id collision.
 *   - Run ONCE. Re-running after the codes already exist would re-remap.
 */
import "dotenv/config";
import { prisma } from "../src/config/prisma";

type RuleRow = {
  id: number;
  type: string | null;
  promocode: string | null;
  title: string | null;
  description: string | null;
  promo_start_at: Date | null;
  promo_expire_at: Date | null;
  status: number | boolean | null;
  discount_type: string | null;
  discount_value: string | number | null;
  promoter_id: number | null;
  applies_to_type: string | null;
  applies_to_ids: unknown;
  created_at: Date | null;
  updated_at: Date | null;
};

const OFFSET = 1_000_000_000;

const asJson = (v: unknown): any => {
  if (v == null) return null;
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v;
};

const asType = (v: string | null): "public" | "private" =>
  v === "public" ? "public" : "private";

(async () => {
  const rules = await prisma.$queryRawUnsafe<RuleRow[]>(`SELECT * FROM ws_promo_code ORDER BY id ASC`);
  console.log(`ws_promo_code rows to merge: ${rules.length}`);

  const idMap = new Map<number, number>(); // old rule id -> new/existing ws_promocode id
  let inserted = 0;
  let reused = 0;

  for (const r of rules) {
    const code = (r.promocode ?? "").toUpperCase();

    const existing = code
      ? await prisma.promocode.findFirst({ where: { promocode: code }, select: { id: true } })
      : null;

    if (existing) {
      idMap.set(r.id, existing.id);
      reused++;
      console.log(`  reuse  rule#${r.id} "${code}" -> ws_promocode#${existing.id} (dedup)`);
      continue;
    }

    const created = await prisma.promocode.create({
      data: {
        type: asType(r.type),
        promocode: code || null,
        title: r.title,
        description: r.description,
        promo_start_at: r.promo_start_at,
        promo_expire_at: r.promo_expire_at,
        status: !!r.status,
        discountType: r.discount_type ?? "percentage",
        discountValue: Number(r.discount_value ?? 0),
        promoterId: r.promoter_id ?? null,
        appliesToType: r.applies_to_type,
        appliesToIds: asJson(r.applies_to_ids),
        created_at: r.created_at,
        updated_at: r.updated_at,
      },
      select: { id: true },
    });
    idMap.set(r.id, created.id);
    inserted++;
    console.log(`  insert rule#${r.id} "${code}" -> ws_promocode#${created.id}`);
  }

  // Remap plan-links whose id actually changed (old rule id != new ws_promocode id).
  const changed = [...idMap.entries()].filter(([oldId, newId]) => oldId !== newId);
  console.log(`\nplan-link remaps needed: ${changed.length}`);

  if (changed.length) {
    const oldIds = changed.map(([oldId]) => oldId);
    // Phase 1: park affected rows in the offset id space so phase 2 can't collide.
    const parked = await prisma.$executeRawUnsafe(
      `UPDATE ws_promoted_package_course_ebook SET promocode_id = promocode_id + ${OFFSET} WHERE promocode_id IN (${oldIds.join(",")})`
    );
    console.log(`  parked ${parked} promoted rows into offset space`);
    // Phase 2: land each parked row on its new id.
    let landed = 0;
    for (const [oldId, newId] of changed) {
      landed += await prisma.$executeRawUnsafe(
        `UPDATE ws_promoted_package_course_ebook SET promocode_id = ${newId} WHERE promocode_id = ${oldId + OFFSET}`
      );
    }
    console.log(`  landed ${landed} promoted rows on new ids`);
  }

  console.log(`\nDONE — inserted ${inserted}, reused ${reused}, total mapped ${idMap.size}.`);
  console.log(`Verify, then apply docs/migration/schema-changes/2026-07-08_drop_ws_promo_code.sql`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error("FATAL", e?.message ?? e);
  await prisma.$disconnect();
  process.exit(1);
});
