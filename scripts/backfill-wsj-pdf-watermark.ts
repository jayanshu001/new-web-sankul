/**
 * Govt-jobs — stamp the websankul.com watermark (src/utils/pdfWatermark.ts) on
 * every PDF already referenced from a `wsj_*` table. New uploads are stamped by
 * the `watermarkPdfs` middleware; this catches everything uploaded before it.
 *
 * Usage:
 *   npx tsx scripts/backfill-wsj-pdf-watermark.ts            # dry run — scan + report only
 *   npx tsx scripts/backfill-wsj-pdf-watermark.ts --apply    # back up, stamp, overwrite
 *   npx tsx scripts/backfill-wsj-pdf-watermark.ts --apply --limit=5   # try a few first
 *
 * How it works:
 *   1. Every text/JSON column of every `wsj_%` table is scanned for `*.pdf`
 *      URLs (pdf_url, card/detail JSON, body_html, normalized detail tables…).
 *   2. Only URLs that point at our own Spaces bucket (DO_BUCKET, origin or CDN
 *      host) are touched — official links (ssc.gov.in etc.) are just reported.
 *   3. Each object is stamped *in place* (same key → same URL), so no DB row
 *      changes. Before overwriting, the original is copied to
 *      `backups/wsj-pdf-watermark/<run>/<key>` for rollback.
 *
 * Idempotent: watermarkPdf() returns null for files that already carry the
 * WebsankulWatermark marker (or are encrypted/corrupt) and those are skipped.
 * A JSON report is written to scripts/output/.
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const LIMIT = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1]) || Infinity;
const CONCURRENCY = 3;

const PDF_URL_RE = /https?:\/\/[^\s"'<>()\\]+?\.pdf(?=$|[?#\s"'<>()\\])/gi;
const TEXT_TYPES = ["char", "varchar", "tinytext", "text", "mediumtext", "longtext", "json"];

type Outcome = "stamped" | "already-stamped-or-unreadable" | "would-stamp" | "missing" | "failed";
type Result = { key: string; url: string; outcome: Outcome; bytesBefore?: number; bytesAfter?: number; error?: string };

/** Maps a public URL onto an object key in our bucket, or null if it isn't ours. */
const keyFor = (rawUrl: string, bucket: string, region: string): string | null => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const pathname = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const ours = new Set([
    `${bucket}.${region}.digitaloceanspaces.com`,
    `${bucket}.${region}.cdn.digitaloceanspaces.com`,
  ]);
  if (ours.has(host)) return pathname || null;
  // Path-style: <region>.digitaloceanspaces.com/<bucket>/<key>
  if (host === `${region}.digitaloceanspaces.com` && pathname.startsWith(`${bucket}/`)) {
    return pathname.slice(bucket.length + 1) || null;
  }
  return null;
};

const runPool = async <T>(items: T[], size: number, worker: (item: T, i: number) => Promise<void>) => {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await worker(items[i], i);
      }
    })
  );
};

const main = async () => {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("Missing DATABASE_URL. Copy .env.example → .env and set MySQL URL.");
    process.exit(1);
  }
  if (APPLY && (!process.env.DO_ACCESS_KEY_ID || !process.env.DO_SECRET_ACCESS_KEY)) {
    console.error("Missing DigitalOcean Spaces credentials — cannot --apply.");
    process.exit(1);
  }

  const { prisma, disconnectPrisma } = await import("../src/config/prisma");
  const { s3Config, DO_BUCKET } = await import("../src/middlewares/upload");
  const { watermarkPdf } = await import("../src/utils/pdfWatermark");
  const { GetObjectCommand, HeadObjectCommand, CopyObjectCommand, PutObjectCommand } = await import(
    "@aws-sdk/client-s3"
  );
  const region = process.env.DO_DEFAULT_REGION || "blr1";

  try {
    // ── 1. Collect PDF URLs from every wsj_* text/JSON column ────────────────
    const columns: { table: string; column: string }[] = await prisma.$queryRawUnsafe(
      `SELECT TABLE_NAME AS \`table\`, COLUMN_NAME AS \`column\`
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME LIKE 'wsj\\_%'
          AND DATA_TYPE IN (${TEXT_TYPES.map((t) => `'${t}'`).join(",")})
        ORDER BY TABLE_NAME, ORDINAL_POSITION`
    );

    const sources = new Map<string, Set<string>>(); // url → "table.column"
    for (const { table, column } of columns) {
      const rows: { v: unknown }[] = await prisma.$queryRawUnsafe(
        `SELECT CAST(\`${column}\` AS CHAR) AS v FROM \`${table}\` WHERE LOWER(CAST(\`${column}\` AS CHAR)) LIKE '%.pdf%'`
      );
      for (const { v } of rows) {
        // JSON columns may hold escaped slashes ("https:\/\/…").
        const text = String(v ?? "").replace(/\\\//g, "/");
        for (const match of text.matchAll(PDF_URL_RE)) {
          const url = match[0];
          if (!sources.has(url)) sources.set(url, new Set());
          sources.get(url)!.add(`${table}.${column}`);
        }
      }
    }

    // ── 2. Split into ours (by object key) vs external ───────────────────────
    const byKey = new Map<string, string>(); // key → first URL seen
    const external: string[] = [];
    for (const url of sources.keys()) {
      const key = keyFor(url, DO_BUCKET, region);
      if (key) {
        if (!byKey.has(key)) byKey.set(key, url);
      } else {
        external.push(url);
      }
    }

    const perColumn = new Map<string, number>();
    for (const cols of sources.values()) for (const c of cols) perColumn.set(c, (perColumn.get(c) || 0) + 1);

    console.log(`Scanned ${columns.length} wsj_* columns — ${sources.size} distinct PDF URLs.`);
    for (const [col, n] of [...perColumn].sort((a, b) => b[1] - a[1])) console.log(`  ${col}: ${n}`);
    console.log(`  → ${byKey.size} objects in bucket "${DO_BUCKET}", ${external.length} external/other-bucket URLs (left alone).`);

    // ── 3. Stamp ─────────────────────────────────────────────────────────────
    const runId = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPrefix = `backups/wsj-pdf-watermark/${runId}`;
    const targets = [...byKey].slice(0, LIMIT);
    const results: Result[] = [];

    await runPool(targets, CONCURRENCY, async ([key, url], i) => {
      const tag = `[${i + 1}/${targets.length}] ${key}`;
      try {
        let head;
        try {
          head = await s3Config.send(new HeadObjectCommand({ Bucket: DO_BUCKET, Key: key }));
        } catch (err: any) {
          if (err?.$metadata?.httpStatusCode === 404 || err?.name === "NotFound") {
            results.push({ key, url, outcome: "missing" });
            console.warn(`${tag} — missing in bucket`);
            return;
          }
          throw err;
        }

        const obj = await s3Config.send(new GetObjectCommand({ Bucket: DO_BUCKET, Key: key }));
        const original = Buffer.from(await obj.Body!.transformToByteArray());
        const stamped = await watermarkPdf(original);
        if (!stamped) {
          results.push({ key, url, outcome: "already-stamped-or-unreadable", bytesBefore: original.length });
          console.log(`${tag} — skipped (already stamped / unreadable)`);
          return;
        }
        if (!APPLY) {
          results.push({ key, url, outcome: "would-stamp", bytesBefore: original.length, bytesAfter: stamped.length });
          console.log(`${tag} — would stamp`);
          return;
        }

        await s3Config.send(
          new CopyObjectCommand({
            Bucket: DO_BUCKET,
            Key: `${backupPrefix}/${key}`,
            CopySource: `${DO_BUCKET}/${key.split("/").map(encodeURIComponent).join("/")}`,
            ACL: "private",
          })
        );
        await s3Config.send(
          new PutObjectCommand({
            Bucket: DO_BUCKET,
            Key: key,
            Body: Buffer.from(stamped),
            ContentType: "application/pdf",
            ACL: "public-read",
            CacheControl: head.CacheControl,
            ContentDisposition: head.ContentDisposition,
            Metadata: head.Metadata,
          })
        );
        results.push({ key, url, outcome: "stamped", bytesBefore: original.length, bytesAfter: stamped.length });
        console.log(`${tag} — stamped`);
      } catch (err: any) {
        results.push({ key, url, outcome: "failed", error: err?.message || String(err) });
        console.error(`${tag} — FAILED: ${err?.message || err}`);
      }
    });

    // ── 4. Report ────────────────────────────────────────────────────────────
    const counts = results.reduce<Record<string, number>>((acc, r) => {
      acc[r.outcome] = (acc[r.outcome] || 0) + 1;
      return acc;
    }, {});
    const outDir = path.resolve(__dirname, "output");
    fs.mkdirSync(outDir, { recursive: true });
    const reportPath = path.join(outDir, `wsj-pdf-watermark-${APPLY ? "apply" : "dry-run"}-${runId}.json`);
    fs.writeFileSync(
      reportPath,
      JSON.stringify(
        {
          mode: APPLY ? "apply" : "dry-run",
          bucket: DO_BUCKET,
          backupPrefix: APPLY ? backupPrefix : null,
          counts,
          results,
          external,
          sources: Object.fromEntries([...sources].map(([u, c]) => [u, [...c]])),
        },
        null,
        2
      )
    );

    console.log(`\n${APPLY ? "Applied" : "Dry run"}: ${JSON.stringify(counts)}`);
    if (APPLY) console.log(`Originals backed up under s3://${DO_BUCKET}/${backupPrefix}/`);
    console.log(`Report: ${path.relative(process.cwd(), reportPath)}`);
    if (counts.failed) process.exitCode = 1;
  } finally {
    await disconnectPrisma();
  }
};

main().catch((err) => {
  console.error("Watermark backfill failed:", err);
  process.exit(1);
});
