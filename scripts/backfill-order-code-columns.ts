/**
 * Repair the money + code columns on `ws_package_course_order` and the code
 * column on `ws_ebook_order`.
 *
 * NO DDL. Every column touched here already exists; this only rewrites values.
 *
 * THE CONTRACT the order row is supposed to satisfy (now enforced at write time
 * by commerce-order.repository.createPendingOrder):
 *
 *   price (list) − code_discount (promo/referral) − ws_coin (wallet) = discount_price (paid)
 *
 *   • price          — the plan's LIST price, before any discount
 *   • code_discount  — rupees knocked off by the promo/referral code ONLY
 *   • discount_price — what the customer actually paid (charged to Razorpay)
 *   • promocode      — purchase-time SNAPSHOT OBJECT of the redeemed promocode
 *   • refferalcode   — purchase-time SNAPSHOT OBJECT of the redeemed referral code
 *
 * WHY THE CODE COLUMNS MUST HOLD OBJECTS, NOT THE CODE STRING:
 * `modules/promoter-data` computes the whole promoter dashboard (attributed
 * subscriptions, revenue, commission) by JSON-path querying these columns:
 *   WHERE JSON_EXTRACT(o.promocode,'$.promoterId') = ?
 *   JSON_EXTRACT(o.promocode,'$.promotedPackageCourseEbook[0].promoterPercentage')
 * A bare string is a valid json value but matches none of those paths, so a
 * flattened order is invisible to promoter attribution and pays out nothing.
 * Snapshots are rebuilt here with the SAME builder the live checkout path uses
 * (modules/order-code-snapshot), so backfilled and new rows are identical.
 *
 * DEFECTS BEING CLEANED UP:
 *   1. The SQL create-order path wrote the CHARGED amount into `price` and never
 *      wrote `code_discount` / `promocode` / `refferalcode` at all — so post-
 *      migration rows read as "list price == paid, zero discount, no code".
 *   2. An interim fix wrote the code as a bare STRING, which fixed the report's
 *      "[Object]" display but broke promoter attribution (see above).
 *   3. `ws_ebook_order.promocode` was never written by any code path.
 *
 * PHASES (1-3 are lossless and always on; 4 is inferential and opt-in):
 *   1. HYDRATE  — a bare STRING code → the full snapshot object. Rows that are
 *                 ALREADY objects are left untouched (legacy V1 rows are the
 *                 reference shape, not a defect).
 *   2. RECOVER  — rows whose code defect 1 dropped entirely: the Razorpay payload
 *                 persisted in `razorpay_order` carries the code id in
 *                 `notes.promocodeId`, so the code is recoverable exactly, then
 *                 hydrated to an object like phase 1.
 *   3. WALLET   — wallet-only orders (coins redeemed, no code) lost the coin
 *                 component out of `price` the same way. EXACT, not inferential:
 *                 with no code involved, list price is by construction paid + coin.
 *   4. MONEY    — (--repair-money) rebuild price/code_discount for rows that
 *                 demonstrably lost the split (code_discount=0 AND price=discount_price)
 *                 AND carry a known code, using the plan's list price. INFERENTIAL:
 *                 a plan repriced since the order will produce an approximate
 *                 discount. Skipped whenever the inference isn't sane (see below).
 *                 A row with neither a code nor coins is never touched — for those
 *                 price==paid is the truth, not a defect.
 *
 * `updated_at` is pinned (`updated_at = updated_at`) so a data repair never looks
 * like a business event.
 *
 * PK-batched + resumable: ~500k-row table, so it walks id ranges instead of
 * issuing one unbounded UPDATE (an unbounded sweep over a table this size is what
 * crashed the binlog during the IST backfill). Re-runnable; converges.
 *
 *   npx tsx scripts/backfill-order-code-columns.ts                        # dry run
 *   npx tsx scripts/backfill-order-code-columns.ts --apply                # phases 1-3
 *   npx tsx scripts/backfill-order-code-columns.ts --apply --repair-money # + phase 4
 *   npx tsx scripts/backfill-order-code-columns.ts --apply --from=520000  # resume
 */
import { prisma } from "../src/config/prisma";
import {
  buildPromocodeSnapshot,
  buildReferralSnapshot,
} from "../src/modules/order-code-snapshot/order-code-snapshot.service";

const APPLY = process.argv.includes("--apply");
const REPAIR_MONEY = process.argv.includes("--repair-money");
const fromArg = process.argv.find((a) => a.startsWith("--from="));
const BATCH = 2000;

type Row = {
  id: number;
  plan_id: number | null;
  price: number;
  code_discount: number;
  discount_price: number | null;
  ws_coin: number;
  promo_json: string | null;
  ref_json: string | null;
  promo_type: string | null;
  ref_type: string | null;
  rzp_promocode_id: string | null;
  referrer_id: number | null;
};

type EbookRow = {
  id: number;
  plan_id: number | null;
  promo_json: string | null;
  promo_type: string | null;
  rzp_promocode_id: string | null;
  referrer_id: number | null;
};

/** A JSON scalar string column value → the bare code it holds. */
const codeFromJsonString = (raw: string | null): string | null => {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return typeof v === "string" && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
};

/**
 * A code string → the ids needed to snapshot it. A code is a promocode if
 * ws_promocode has it, otherwise a referral code if a customer owns it. Returns
 * null for a code that no longer resolves to either (deleted promocode /
 * customer) — such a row is left exactly as it is rather than half-rebuilt.
 */
type Resolved = { kind: "promo"; promocodeId: number } | { kind: "referral"; referrerId: number };

async function main() {
  const [{ min_id, max_id, total }] = await prisma.$queryRawUnsafe<
    { min_id: number | null; max_id: number | null; total: bigint }[]
  >(`SELECT MIN(id) min_id, MAX(id) max_id, COUNT(*) total FROM ws_package_course_order`);
  if (min_id == null || max_id == null) {
    console.log("ws_package_course_order is empty — skipping to ws_ebook_order.");
  }

  const start = fromArg ? Number(fromArg.split("=")[1]) : (min_id ?? 0);
  console.log(
    `ws_package_course_order: ${total} row(s), ids ${min_id}..${max_id}; starting at ${start}\n` +
      `  phases: HYDRATE + RECOVER + WALLET${REPAIR_MONEY ? " + MONEY" : " (code-discount repair OFF — pass --repair-money)"}` +
      `${APPLY ? "" : "\n  DRY RUN — pass --apply to write"}\n`
  );

  // code → promocode id, resolved once (the table is small).
  const promoIdByCode = new Map<string, number>(
    (await prisma.promocode.findMany({ select: { id: true, promocode: true } }))
      .filter((p) => p.promocode)
      .map((p) => [(p.promocode as string).trim().toUpperCase(), p.id])
  );
  const codeById = new Map<number, string>(
    [...promoIdByCode.entries()].map(([code, id]) => [id, code])
  );
  // Every customer referral code → its owner, so a code that is NOT a promocode
  // can still be classified and snapshotted into the right column.
  const referrerByCode = new Map<string, number>(
    (
      await prisma.customer.findMany({
        where: { referralCode: { not: null } },
        select: { id: true, referralCode: true },
      })
    )
      .filter((c) => c.referralCode?.trim())
      .map((c) => [(c.referralCode as string).trim().toUpperCase(), c.id])
  );

  const resolveCode = (raw: string | null): Resolved | null => {
    const code = raw?.trim().toUpperCase();
    if (!code) return null;
    const promocodeId = promoIdByCode.get(code);
    if (promocodeId) return { kind: "promo", promocodeId };
    const referrerId = referrerByCode.get(code);
    if (referrerId) return { kind: "referral", referrerId };
    return null;
  };

  let hydrated = 0;
  let recovered = 0;
  let walletFixed = 0;
  let moneyFixed = 0;
  let moneySkipped = 0;
  let unresolved = 0;
  let scanned = 0;

  for (let lo = start; lo <= (max_id ?? -1); lo += BATCH) {
    const hi = lo + BATCH - 1;
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT o.id, o.plan_id, o.price, o.code_discount, o.discount_price, o.ws_coin,
              CAST(o.promocode AS CHAR)    AS promo_json,
              CAST(o.refferalcode AS CHAR) AS ref_json,
              JSON_TYPE(o.promocode)       AS promo_type,
              JSON_TYPE(o.refferalcode)    AS ref_type,
              JSON_UNQUOTE(JSON_EXTRACT(o.razorpay_order, '$.notes.promocodeId')) AS rzp_promocode_id,
              o.referrer_id
         FROM ws_package_course_order o
        WHERE o.id BETWEEN ${lo} AND ${hi}`
    );
    if (!rows.length) continue;
    scanned += rows.length;

    // Plan list prices for this batch (phase 4 only).
    const planIds = [...new Set(rows.map((r) => r.plan_id).filter((p): p is number => !!p))];
    const planPrice = new Map<number, number>(
      REPAIR_MONEY && planIds.length
        ? (
            await prisma.packageCourseEbookPrice.findMany({
              where: { id: { in: planIds } },
              select: { id: true, price: true },
            })
          ).map((p) => [p.id, p.price])
        : []
    );

    for (const r of rows) {
      const sets: string[] = [];
      const params: unknown[] = [];

      // A row already holding an OBJECT in a column is the reference shape — never
      // rewrite it. Only STRING (interim flattened) and missing values are repaired.
      const promoIsObject = r.promo_type === "OBJECT";
      const refIsObject = r.ref_type === "OBJECT";

      /** Queue `col = CAST(? AS JSON)` with the snapshot bound as a parameter. */
      const setJson = (col: string, value: unknown) => {
        sets.push(`${col} = CAST(? AS JSON)`);
        params.push(JSON.stringify(value));
      };

      /** Build + queue the snapshot for a resolved code, into the right column. */
      const applyResolved = async (res: Resolved): Promise<boolean> => {
        if (r.plan_id == null) return false;
        if (res.kind === "promo") {
          const snap = await buildPromocodeSnapshot(res.promocodeId, r.plan_id);
          if (!snap) return false;
          setJson("promocode", snap);
          return true;
        }
        const snap = await buildReferralSnapshot(res.referrerId, r.plan_id);
        if (!snap) return false;
        setJson("refferalcode", snap);
        return true;
      };

      // ── phase 1: hydrate a bare STRING code into the snapshot object ─────────
      let known = promoIsObject || refIsObject;
      if (r.promo_type === "STRING" || r.ref_type === "STRING") {
        const res =
          resolveCode(codeFromJsonString(r.promo_json)) ??
          resolveCode(codeFromJsonString(r.ref_json));
        if (res && (await applyResolved(res))) {
          // A code that moves columns (a referral string parked in `promocode`)
          // must not be left behind in the old one.
          if (res.kind === "referral" && r.promo_type === "STRING") sets.push(`promocode = NULL`);
          if (res.kind === "promo" && r.ref_type === "STRING") sets.push(`refferalcode = NULL`);
          hydrated++;
          known = true;
        } else {
          // Code no longer resolves (promocode or customer deleted). Leave the
          // string in place — it is still the truth about what was redeemed.
          unresolved++;
          known = true;
        }
      }

      // ── phase 2: recover a code the create path dropped entirely ─────────────
      if (!known && r.rzp_promocode_id) {
        const code = codeById.get(Number(r.rzp_promocode_id));
        const res = resolveCode(code ?? null);
        if (res && (await applyResolved(res))) {
          recovered++;
          known = true;
        }
      }
      // A referral order writes no promocodeId into the Razorpay notes, so
      // referrer_id is its only fingerprint — recover those from the column.
      if (!known && r.referrer_id != null && r.plan_id != null) {
        const snap = await buildReferralSnapshot(r.referrer_id, r.plan_id);
        if (snap) {
          setJson("refferalcode", snap);
          recovered++;
          known = true;
        }
      }

      const paid = r.discount_price ?? 0;
      const lostSplit = r.code_discount === 0 && r.price === paid;

      // ── phase 3: wallet-only orders (lossless, always on) ───────────────────
      // A coin redemption discounts the order too, so the old create path lost the
      // wallet component out of `price` exactly as it lost the promo component.
      // Here the repair is EXACT rather than inferential: with no code involved,
      // list price is by construction paid + coin — no plan lookup, so no exposure
      // to a plan repriced since the order.
      const noCodeAtAll = !known && !r.rzp_promocode_id && r.referrer_id == null;
      if (noCodeAtAll && lostSplit && (r.ws_coin ?? 0) > 0) {
        sets.push(`price = ${paid + r.ws_coin}`);
        walletFixed++;
      }

      // ── phase 4: rebuild the code discount split (inferential, opt-in) ──────
      if (REPAIR_MONEY && known && lostSplit) {
        const list = r.plan_id != null ? planPrice.get(r.plan_id) : undefined;
        const discount = list != null ? list - paid - (r.ws_coin ?? 0) : NaN;
        // Sanity gates — a plan repriced since the order (or a legacy row whose
        // paid amount never matched its plan) must NOT produce a bogus split.
        if (list != null && discount > 0 && discount < list) {
          sets.push(`price = ${list}`, `code_discount = ${discount}`);
          moneyFixed++;
        } else {
          moneySkipped++;
        }
      }

      if (!sets.length) continue;
      if (APPLY) {
        // `updated_at = updated_at` pins the column: a repair is not a business event.
        await prisma.$executeRawUnsafe(
          `UPDATE ws_package_course_order SET ${sets.join(", ")}, updated_at = updated_at WHERE id = ${r.id}`,
          ...params
        );
      } else if (scanned <= BATCH) {
        console.log(`  id ${r.id}: ${sets.join(", ")}`);
      }
    }

    if (rows.length) console.log(`  …scanned through id ${hi} (${scanned} rows)`);
  }

  console.log(
    `\n${APPLY ? "Applied" : "Would apply"} to ws_package_course_order:\n` +
      `  hydrated string→object : ${hydrated}\n` +
      `  recovered dropped codes: ${recovered}\n` +
      `  wallet-only price fixes: ${walletFixed} (exact: price = paid + ws_coin)\n` +
      (REPAIR_MONEY
        ? `  money splits rebuilt   : ${moneyFixed}\n` +
          `  money splits skipped   : ${moneySkipped} (plan repriced / inference unsafe — left as-is)\n`
        : "") +
      `  codes left unresolved  : ${unresolved} (promocode/customer deleted — string kept)\n` +
      `  rows scanned           : ${scanned}`
  );

  // ── ws_ebook_order: code column only ───────────────────────────────────────
  // No list-price/discount pair exists on this table (order_price is the charged
  // amount and there is nowhere to record the split without DDL), so only the
  // snapshot is repaired here.
  await backfillEbookOrders(resolveCode, codeById);
}

async function backfillEbookOrders(
  resolveCode: (raw: string | null) => Resolved | null,
  codeById: Map<number, string>
) {
  const [{ min_id, max_id, total }] = await prisma.$queryRawUnsafe<
    { min_id: number | null; max_id: number | null; total: bigint }[]
  >(`SELECT MIN(id) min_id, MAX(id) max_id, COUNT(*) total FROM ws_ebook_order`);
  if (min_id == null || max_id == null) {
    console.log("\nws_ebook_order is empty — nothing to do.");
    return;
  }
  console.log(`\nws_ebook_order: ${total} row(s), ids ${min_id}..${max_id}`);

  let hydrated = 0;
  let recovered = 0;
  let scanned = 0;

  for (let lo = min_id; lo <= max_id; lo += BATCH) {
    const hi = lo + BATCH - 1;
    const rows = await prisma.$queryRawUnsafe<EbookRow[]>(
      `SELECT o.id, o.plan_id,
              CAST(o.promocode AS CHAR) AS promo_json,
              JSON_TYPE(o.promocode)    AS promo_type,
              JSON_UNQUOTE(JSON_EXTRACT(o.razorpay_order, '$.notes.promocodeId')) AS rzp_promocode_id,
              o.referrer_id
         FROM ws_ebook_order o
        WHERE o.id BETWEEN ${lo} AND ${hi}`
    );
    if (!rows.length) continue;
    scanned += rows.length;

    for (const r of rows) {
      if (r.promo_type === "OBJECT" || r.plan_id == null) continue;

      let snap: unknown = null;
      let phase: "hydrate" | "recover" | null = null;

      if (r.promo_type === "STRING") {
        const res = resolveCode(codeFromJsonString(r.promo_json));
        if (res) {
          snap =
            res.kind === "promo"
              ? await buildPromocodeSnapshot(res.promocodeId, r.plan_id)
              : await buildReferralSnapshot(res.referrerId, r.plan_id);
          phase = "hydrate";
        }
      } else if (r.rzp_promocode_id) {
        const res = resolveCode(codeById.get(Number(r.rzp_promocode_id)) ?? null);
        if (res) {
          snap =
            res.kind === "promo"
              ? await buildPromocodeSnapshot(res.promocodeId, r.plan_id)
              : await buildReferralSnapshot(res.referrerId, r.plan_id);
          phase = "recover";
        }
      } else if (r.referrer_id != null) {
        // Referral orders carry no promocodeId in the Razorpay notes.
        snap = await buildReferralSnapshot(r.referrer_id, r.plan_id);
        phase = "recover";
      }

      if (!snap || !phase) continue;
      if (phase === "hydrate") hydrated++;
      else recovered++;

      if (APPLY) {
        await prisma.$executeRawUnsafe(
          `UPDATE ws_ebook_order SET promocode = CAST(? AS JSON), updated_at = updated_at WHERE id = ${r.id}`,
          JSON.stringify(snap)
        );
      } else if (scanned <= BATCH) {
        console.log(`  id ${r.id}: promocode = <${phase} snapshot>`);
      }
    }
  }

  console.log(
    `${APPLY ? "Applied" : "Would apply"} to ws_ebook_order:\n` +
      `  hydrated string→object : ${hydrated}\n` +
      `  recovered dropped codes: ${recovered}\n` +
      `  rows scanned           : ${scanned}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exit(1);
  });
