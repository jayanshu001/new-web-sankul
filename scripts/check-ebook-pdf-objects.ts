/**
 * Audit ebook PDF storage: for every active ebook with a non-empty book_url /
 * book_demo_url, HEAD the object in the Spaces bucket and report whether it
 * actually EXISTS. This finds the ebooks that issue a media token but resolve to
 * a signed URL that 404s (NoSuchKey) — the "PDF won't open" class of bug.
 *
 * Reads the SAME bucket + credentials the media signer uses (DO_* env via
 * src/middlewares/upload). Run it against the SAME environment whose app is failing
 * (staging DATABASE_URL + staging DO_* creds), or it will report false mismatches.
 *
 * Usage:
 *   npx tsx scripts/check-ebook-pdf-objects.ts             # report only
 *   npx tsx scripts/check-ebook-pdf-objects.ts --missing   # print ONLY the broken ones
 *   npx tsx scripts/check-ebook-pdf-objects.ts --null-missing  # ⚠ set book_url/book_demo_url = NULL where the object is missing (stops issuing dead tokens)
 */
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "../src/config/prisma";
import { s3Config, DO_BUCKET } from "../src/middlewares/upload";

const client = s3Config as any;
const ONLY_MISSING = process.argv.includes("--missing");
const NULL_MISSING = process.argv.includes("--null-missing");

// Same normalization the resolver uses: strip host/scheme, leading slash, trailing
// quote artifacts, and a leading "<bucket>/" so we HEAD the bare object key.
const toObjectKey = (urlOrKey: string): string => {
  if (!/^https?:\/\//i.test(urlOrKey)) return urlOrKey.replace(/^\/+/, "");
  try {
    let key = new URL(urlOrKey).pathname.replace(/^\/+/, "");
    key = key.replace(/(?:"|%22|%2522)+$/i, "");
    if (DO_BUCKET && key.startsWith(`${DO_BUCKET}/`)) key = key.slice(DO_BUCKET.length + 1);
    return decodeURIComponent(key);
  } catch {
    return urlOrKey;
  }
};

type Status = "OK" | "MISSING" | "ERROR";
const headStatus = async (key: string): Promise<{ status: Status; detail?: string }> => {
  try {
    await client.send(new HeadObjectCommand({ Bucket: DO_BUCKET, Key: key }));
    return { status: "OK" };
  } catch (e: any) {
    const code = e?.$metadata?.httpStatusCode;
    if (code === 404 || e?.name === "NotFound") return { status: "MISSING" };
    return { status: "ERROR", detail: `${e?.name ?? "err"} ${code ?? ""}`.trim() };
  }
};

async function main() {
  const ebooks = await prisma.eBook.findMany({
    where: { active: true },
    select: { id: true, name: true, bookUrl: true, bookDemoUrl: true },
    orderBy: { id: "asc" },
  });
  console.log(`Bucket: ${DO_BUCKET} — checking ${ebooks.length} active ebooks…\n`);

  const targets: { id: number; name: string | null; field: "bookUrl" | "bookDemoUrl"; url: string }[] = [];
  for (const e of ebooks) {
    if (e.bookUrl) targets.push({ id: e.id, name: e.name, field: "bookUrl", url: e.bookUrl });
    if (e.bookDemoUrl) targets.push({ id: e.id, name: e.name, field: "bookDemoUrl", url: e.bookDemoUrl });
  }

  let ok = 0, missing = 0, error = 0;
  const broken: typeof targets = [];

  // Small concurrency to avoid hammering the bucket.
  const CONC = 16;
  for (let i = 0; i < targets.length; i += CONC) {
    const chunk = targets.slice(i, i + CONC);
    const results = await Promise.all(
      chunk.map(async (t) => ({ t, key: toObjectKey(t.url), ...(await headStatus(toObjectKey(t.url))) }))
    );
    for (const r of results) {
      if (r.status === "OK") ok++;
      else if (r.status === "MISSING") { missing++; broken.push(r.t); }
      else error++;
      if (!ONLY_MISSING || r.status !== "OK") {
        console.log(`[${r.status.padEnd(7)}] ebook ${r.t.id} (${r.t.field}) key="${r.key}"${r.detail ? ` — ${r.detail}` : ""}${r.status !== "OK" ? `  «${r.t.name ?? ""}»` : ""}`);
      }
    }
  }

  console.log(`\nSummary: ${ok} OK, ${missing} MISSING, ${error} ERROR (of ${targets.length} PDF slots).`);

  if (NULL_MISSING && broken.length) {
    console.log(`\n--null-missing: nulling ${broken.length} dead PDF slots so they stop issuing tokens…`);
    for (const b of broken) {
      await prisma.eBook.update({ where: { id: b.id }, data: { [b.field]: null } as any });
    }
    console.log("Done. Those ebooks will now return null tokens until a real PDF is attached.");
  } else if (broken.length) {
    console.log(`\nFix: re-upload the PDF (admin PDF-upload pipeline) or correct the stored key for the MISSING slots above.`);
    console.log(`Or run with --null-missing to blank the dead slots so the app stops showing doomed Read/Demo actions.`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
