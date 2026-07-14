/**
 * Audit book / ebook demo (and full) media against the Spaces bucket.
 *
 * WHY: /client/media/resolve returns a clean 404 ("This book demo is not
 * available." / "This e-book is not available.") when a stored URL points at an
 * object that does NOT exist in the CURRENT bucket. That happens with old data —
 * rows carried over from another environment (prod ↔ staging), a since-deleted
 * file, or a corrupted key. The resolver can't invent the missing PDF; this
 * script pinpoints exactly which rows are broken so the file can be re-uploaded
 * or the URL corrected.
 *
 * It mirrors the resolver's own key-derivation + external-passthrough logic
 * (client-media.service.ts) so a row reported OK here resolves OK at runtime, and
 * a row reported BROKEN here is exactly what a client would hit.
 *
 * Read-only. Runs against whatever DATABASE_URL / DO_* env the process has.
 *
 * Also probes EXTERNAL urls (not just own-bucket): a HEAD/GET that returns 4xx/5xx
 * is flagged "external_DEAD" — e.g. legacy `gpsconline.com` material links whose
 * host now 500s. Those reach the client verbatim (they're public passthrough), so
 * the client sees the origin's error when opening the PDF.
 *
 *   npx tsx scripts/audit-book-demo-media.ts              # books + ebooks + materials
 *   npx tsx scripts/audit-book-demo-media.ts --books      # books only
 *   npx tsx scripts/audit-book-demo-media.ts --ebooks     # ebooks only
 *   npx tsx scripts/audit-book-demo-media.ts --materials  # materials only
 */
import { prisma } from "../src/config/prisma";
import { s3Config, DO_BUCKET, isOwnBucketUrl } from "../src/middlewares/upload";
import { HeadObjectCommand } from "@aws-sdk/client-s3";

// ── mirror resolver helpers (client-media.service.ts) ───────────────────────
const toObjectKey = (urlOrKey: string): string => {
  let s = (urlOrKey ?? "").trim();
  if (!/^https?:\/\//i.test(s) && /^[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?\//i.test(s)) s = `https://${s}`;
  if (!/^https?:\/\//i.test(s)) return s.replace(/^\/+/, "");
  try {
    let key = new URL(s).pathname.replace(/^\/+/, "");
    key = key.replace(/(?:"|%22|%2522)+$/i, "");
    if (DO_BUCKET && key.startsWith(`${DO_BUCKET}/`)) key = key.slice(DO_BUCKET.length + 1);
    return decodeURIComponent(key);
  } catch {
    return urlOrKey;
  }
};

const SPACES_HOST = (() => {
  try { return new URL(process.env.DO_ENDPOINT || "https://blr1.digitaloceanspaces.com").host; }
  catch { return "blr1.digitaloceanspaces.com"; }
})();
const pointsAtOurSpaces = (src: string): boolean => {
  if (isOwnBucketUrl(src)) return true;
  try {
    const host = new URL(/^https?:\/\//i.test(src) ? src : `https://${src}`).host;
    return host === SPACES_HOST || host.endsWith(`.${SPACES_HOST}`);
  } catch {
    return false;
  }
};

// "external_ok"   — external host, HTTP HEAD/GET returned 2xx (openable)
// "external_dead" — external host, returned 4xx/5xx (this is the gpsconline case)
// "exists"        — own-bucket object present
// "missing"       — own-bucket object absent (would 404 at /media/resolve)
// "inconclusive"  — HEAD errored transiently (permission/network) → not proven broken
type Disposition = "external_ok" | "external_dead" | "exists" | "missing" | "inconclusive";
const HTTP_TIMEOUT_MS = Number(process.env.AUDIT_HTTP_TIMEOUT_MS) || 12_000;

// Probe an external URL. HEAD first; some hosts 405 HEAD, so fall back to a ranged
// GET. Returns the HTTP status (or 0 on network failure/timeout).
const probeExternal = async (url: string): Promise<number> => {
  const once = async (method: "HEAD" | "GET"): Promise<number> => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), HTTP_TIMEOUT_MS);
    try {
      const res = await fetch(url, { method, redirect: "follow", signal: ac.signal, headers: method === "GET" ? { Range: "bytes=0-0" } : undefined });
      return res.status;
    } catch { return 0; }
    finally { clearTimeout(t); }
  };
  let s = await once("HEAD");
  if (s === 0 || s === 405 || s === 501) s = await once("GET");
  return s;
};

const check = async (src: string): Promise<{ disp: Disposition; key: string; note?: string }> => {
  const isHttp = /^https?:\/\//i.test(src);
  if (isHttp && !pointsAtOurSpaces(src)) {
    const status = await probeExternal(src);
    if (status >= 200 && status < 400) return { disp: "external_ok", key: "" };
    return { disp: "external_dead", key: "", note: `HTTP ${status || "no-response"}` };
  }
  const key = toObjectKey(src);
  try {
    await (s3Config as any).send(new HeadObjectCommand({ Bucket: DO_BUCKET, Key: key }));
    return { disp: "exists", key };
  } catch (e: any) {
    const code = e?.$metadata?.httpStatusCode;
    if (code === 404 || e?.name === "NotFound" || e?.name === "NoSuchKey") return { disp: "missing", key };
    return { disp: "inconclusive", key, note: e?.name ?? String(e) };
  }
};

// Bounded-concurrency map (external probes can be hundreds of rows).
const CONCURRENCY = Number(process.env.AUDIT_CONCURRENCY) || 12;
const mapLimit = async <T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> => {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
};

// ── audit one "source" (a named URL column on a set of rows) ────────────────
type Row = { id: number; title: string; url: string | null };
const auditColumn = async (label: string, rows: Row[]) => {
  const tally: Record<Disposition | "empty", number> = { external_ok: 0, external_dead: 0, exists: 0, missing: 0, inconclusive: 0, empty: 0 };
  const broken: Array<{ id: number; title: string; key: string; url: string; why: string }> = [];
  await mapLimit(rows, CONCURRENCY, async (r) => {
    if (!r.url) { tally.empty++; return; }
    const { disp, key, note } = await check(r.url);
    tally[disp]++;
    if (disp === "missing") broken.push({ id: r.id, title: r.title, key, url: r.url, why: "own-bucket object missing" });
    if (disp === "external_dead") broken.push({ id: r.id, title: r.title, key: "(external)", url: r.url, why: `external host ${note}` });
    if (disp === "inconclusive") console.warn(`  ? ${label} #${r.id} inconclusive HEAD (${note}) key=${key}`);
  });
  console.log(`\n=== ${label} ===`);
  console.log(`  rows=${rows.length}  external_ok=${tally.external_ok}  external_DEAD=${tally.external_dead}  exists=${tally.exists}  MISSING=${tally.missing}  inconclusive=${tally.inconclusive}  empty=${tally.empty}`);
  if (broken.length) {
    console.log(`  BROKEN (client gets an error opening these):`);
    for (const b of broken.slice(0, 100)) console.log(`   • #${b.id}  "${b.title}"  [${b.why}]\n       ${b.url}`);
    if (broken.length > 100) console.log(`   … and ${broken.length - 100} more`);
  }
  return broken.length;
};

(async () => {
  const args = process.argv.slice(2);
  const all = args.length === 0;
  const doBooks = all || args.includes("--books");
  const doEbooks = all || args.includes("--ebooks");
  const doMaterials = all || args.includes("--materials");
  let brokenTotal = 0;

  console.log(`Bucket: ${DO_BUCKET} @ ${SPACES_HOST}  (external HTTP probe on, timeout ${HTTP_TIMEOUT_MS}ms, concurrency ${CONCURRENCY})`);

  if (doBooks) {
    const books: any[] = await prisma.$queryRawUnsafe(
      "SELECT id, name AS title, demo_url FROM ws_book WHERE demo_url IS NOT NULL AND demo_url <> '' AND status = 1"
    );
    brokenTotal += await auditColumn(
      "ws_book.demo_url (bookDemo)",
      books.map((b) => ({ id: b.id, title: b.title ?? "", url: b.demo_url }))
    );
  }

  if (doEbooks) {
    const ebooks: any[] = await prisma.$queryRawUnsafe(
      "SELECT id, name AS title, demo_url, book_url FROM ws_ebook WHERE status = 1"
    );
    brokenTotal += await auditColumn(
      "ws_ebook.demo_url (ebookDemo)",
      ebooks.filter((e) => e.demo_url).map((e) => ({ id: e.id, title: e.title ?? "", url: e.demo_url }))
    );
    brokenTotal += await auditColumn(
      "ws_ebook.book_url (ebook full)",
      ebooks.filter((e) => e.book_url).map((e) => ({ id: e.id, title: e.title ?? "", url: e.book_url }))
    );
  }

  if (doMaterials) {
    const mats: any[] = await prisma.$queryRawUnsafe(
      "SELECT id, title, file, direct_link FROM ws_material WHERE status = 1"
    );
    brokenTotal += await auditColumn(
      "ws_material.file / direct_link (material)",
      // Resolver prefers `file`, falls back to `direct_link` — audit the same source.
      mats.map((m) => ({ id: m.id, title: m.title ?? "", url: (m.file && String(m.file).trim()) || m.direct_link || null }))
    );
  }

  console.log(`\nDONE. Total broken (client would see an error): ${brokenTotal}`);
  await prisma.$disconnect();
  process.exit(brokenTotal > 0 ? 1 : 0);
})().catch(async (e) => {
  console.error("audit failed:", e);
  await prisma.$disconnect();
  process.exit(2);
});
