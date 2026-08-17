/**
 * Repair the money + code columns on `ws_package_course_order`.
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
 *   • promocode      — the bare promocode STRING   (legacy rows: a fat nested object)
 *   • refferalcode   — the bare referral code STRING (legacy rows: never populated)
 *
 * TWO DEFECTS ARE BEING CLEANED UP:
 *   1. Legacy V1 rows serialized the ENTIRE promocode record into `promocode`
 *      (nested promoter + expanded plan rows) instead of the code string.
 *   2. The SQL create-order path wrote the CHARGED amount into `price` and never
 *      wrote `code_discount` / `promocode` / `refferalcode` at all — so post-
 *      migration rows read as "list price == paid, zero discount, no code".
 *
 * PHASES (1-3 are lossless and always on; 4 is inferential and opt-in):
 *   1. FLATTEN  — `promocode`/`refferalcode` JSON object → the bare code string.
 *   2. RECOVER  — rows whose code was dropped by defect 2: the Razorpay order
 *                 payload we persisted in `razorpay_order` carries the code id in
 *                 `notes.promocodeId`, so the code is recoverable exactly.
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
 *   npx tsx scripts/backfill-order-code-columns.ts --apply                # phases 1+2
 *   npx tsx scripts/backfill-order-code-columns.ts --apply --repair-money # + phase 3
 *   npx tsx scripts/backfill-order-code-columns.ts --apply --from=520000  # resume
 */
import { prisma } from "../src/config/prisma";

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

/** Legacy objects aren't uniformly keyed — try every shape V1 ever wrote. */
const codeFromJson = (raw: string | null): string | null => {
  if (!raw) return null;
  let v: any;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v === "string") return v.trim() || null;
  if (v && typeof v === "object") {
    for (const k of ["promocode", "promoCode", "referral_code", "referralCode", "code"]) {
      if (typeof v[k] === "string" && v[k].trim()) return v[k].trim();
    }
  }
  return null;
};

async function main() {
  const [{ min_id, max_id, total }] = await prisma.$queryRawUnsafe<
    { min_id: number | null; max_id: number | null; total: bigint }[]
  >(`SELECT MIN(id) min_id, MAX(id) max_id, COUNT(*) total FROM ws_package_course_order`);
  if (min_id == null || max_id == null) {
    console.log("ws_package_course_order is empty — nothing to do.");
    return;
  }

  const start = fromArg ? Number(fromArg.split("=")[1]) : min_id;
  console.log(
    `ws_package_course_order: ${total} row(s), ids ${min_id}..${max_id}; starting at ${start}\n` +
      `  phases: FLATTEN + RECOVER + WALLET${REPAIR_MONEY ? " + MONEY" : " (code-discount repair OFF — pass --repair-money)"}` +
      `${APPLY ? "" : "\n  DRY RUN — pass --apply to write"}\n`
  );

  // promocode id → code, resolved once (the table is small).
  const codeById = new Map<number, string>(
    (await prisma.promocode.findMany({ select: { id: true, promocode: true } }))
      .filter((p) => p.promocode)
      .map((p) => [p.id, p.promocode as string])
  );
  // Every known referral code, so a recovered code can be classified into the
  // right column instead of being guessed at.
  const referralCodes = new Set(
    (await prisma.customer.findMany({
      where: { referralCode: { not: null } },
      select: { referralCode: true },
    }))
      .map((c) => (c.referralCode ?? "").trim().toUpperCase())
      .filter(Boolean)
  );

  let flattened = 0;
  let recovered = 0;
  let walletFixed = 0;
  let moneyFixed = 0;
  let moneySkipped = 0;
  let scanned = 0;

  for (let lo = start; lo <= max_id; lo += BATCH) {
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

    // Plan list prices for this batch (phase 3 only).
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

      // ── phase 1: flatten a JSON OBJECT code into its bare string ────────────
      let promoCode = r.promo_type === "OBJECT" ? codeFromJson(r.promo_json) : null;
      let refCode = r.ref_type === "OBJECT" ? codeFromJson(r.ref_json) : null;
      if (r.promo_type === "OBJECT") {
        if (promoCode) {
          sets.push(`promocode = ${esc(promoCode)}`);
          flattened++;
        } else {
          // An object we can't read a code out of is worse than nothing — it's the
          // "Object" the report renders. Null it rather than leave a fat blob.
          sets.push(`promocode = NULL`);
          flattened++;
        }
      }
      if (r.ref_type === "OBJECT") {
        sets.push(refCode ? `refferalcode = ${esc(refCode)}` : `refferalcode = NULL`);
        flattened++;
      }

      // ── phase 2: recover a code the create path dropped ─────────────────────
      const alreadyHasCode =
        promoCode || refCode || r.promo_type === "STRING" || r.ref_type === "STRING";
      if (!alreadyHasCode && r.rzp_promocode_id) {
        const code = codeById.get(Number(r.rzp_promocode_id));
        if (code) {
          // Classify: a code that matches a customer's referral_code belongs in
          // refferalcode; anything resolved out of ws_promocode is a promocode.
          if (referralCodes.has(code.toUpperCase())) {
            sets.push(`refferalcode = ${esc(code)}`);
            refCode = code;
          } else {
            sets.push(`promocode = ${esc(code)}`);
            promoCode = code;
          }
          recovered++;
        }
      }

      const knownCode =
        promoCode || refCode || r.promo_type === "STRING" || r.ref_type === "STRING";
      const paid = r.discount_price ?? 0;
      const lostSplit = r.code_discount === 0 && r.price === paid;

      // ── phase 3: wallet-only orders (lossless, always on) ───────────────────
      // A coin redemption discounts the order too, so the old create path lost the
      // wallet component out of `price` exactly as it lost the promo component.
      // Here the repair is EXACT rather than inferential: with no code involved,
      // list price is by construction paid + coin — no plan lookup, so no exposure
      // to a plan repriced since the order.
      //
      // "No code involved" has to be proven on all four signals, because a REFERRAL
      // order carries no promocodeId in the Razorpay notes (promo._id is "" for
      // referrals) — referrer_id is its only fingerprint. If any signal fires, this
      // row belongs to phase 4 instead and is left alone here.
      const noCodeAtAll = !knownCode && !r.rzp_promocode_id && r.referrer_id == null;
      if (noCodeAtAll && lostSplit && (r.ws_coin ?? 0) > 0) {
        sets.push(`price = ${paid + r.ws_coin}`);
        walletFixed++;
      }

      // ── phase 4: rebuild the code discount split (inferential, opt-in) ──────
      if (REPAIR_MONEY) {
        if (knownCode && lostSplit) {
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
      }

      if (!sets.length) continue;
      if (APPLY) {
        // `updated_at = updated_at` pins the column: a repair is not a business event.
        await prisma.$executeRawUnsafe(
          `UPDATE ws_package_course_order SET ${sets.join(", ")}, updated_at = updated_at WHERE id = ${r.id}`
        );
      } else if (scanned <= BATCH) {
        console.log(`  id ${r.id}: ${sets.join(", ")}`);
      }
    }

    if (rows.length) console.log(`  …scanned through id ${hi} (${scanned} rows)`);
  }

  console.log(
    `\n${APPLY ? "Applied" : "Would apply"}:\n` +
      `  flattened object codes : ${flattened}\n` +
      `  recovered dropped codes: ${recovered}\n` +
      `  wallet-only price fixes: ${walletFixed} (exact: price = paid + ws_coin)\n` +
      (REPAIR_MONEY
        ? `  money splits rebuilt   : ${moneyFixed}\n` +
          `  money splits skipped   : ${moneySkipped} (plan repriced / inference unsafe — left as-is)\n`
        : "") +
      `  rows scanned           : ${scanned}`
  );
}

/**
 * A code string, ready to assign to a `json` column. Bare `col = 'ABC'` is
 * rejected by MySQL (ER_INVALID_JSON_TEXT) — the value has to be a JSON scalar,
 * so JSON_QUOTE wraps it into `"ABC"`. That is exactly the shape Prisma writes
 * for a JS string on the live path, and the shape `promoCodeOf` already reads.
 */
const esc = (s: string) => `JSON_QUOTE('${s.replace(/\\/g, "\\\\").replace(/'/g, "''")}')`;

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exit(1);
  });
