/**
 * Shared by scripts/backfill-wsj-pdf-watermark.ts and scripts/backup-wsj-pdfs.ts:
 * finds every `*.pdf` URL referenced from any text/JSON column of any `wsj_%`
 * table (pdf_url, card/detail JSON, body_html, normalized detail tables…),
 * together with the row it came from.
 */

export type PdfRef = {
  table: string;
  column: string;
  /** Row primary key (`id` column) as a string, or null for tables without one. */
  id: string | null;
  url: string;
  /** Object key in our bucket, or null for external / other-bucket URLs. */
  key: string | null;
};

const PDF_URL_RE = /https?:\/\/[^\s"'<>()\\]+?\.pdf(?=$|[?#\s"'<>()\\])/gi;
const TEXT_TYPES = ["char", "varchar", "tinytext", "text", "mediumtext", "longtext", "json"];

/** Maps a public URL onto an object key in our bucket, or null if it isn't ours. */
export const keyFor = (rawUrl: string, bucket: string, region: string): string | null => {
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

export const collectWsjPdfRefs = async (
  prisma: any,
  bucket: string,
  region: string
): Promise<{ columnsScanned: number; refs: PdfRef[] }> => {
  const columns: { table: string; column: string }[] = await prisma.$queryRawUnsafe(
    `SELECT TABLE_NAME AS \`table\`, COLUMN_NAME AS \`column\`
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME LIKE 'wsj\\_%'
        AND DATA_TYPE IN (${TEXT_TYPES.map((t) => `'${t}'`).join(",")})
      ORDER BY TABLE_NAME, ORDINAL_POSITION`
  );
  const withId: { table: string }[] = await prisma.$queryRawUnsafe(
    `SELECT TABLE_NAME AS \`table\`
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'wsj\\_%' AND COLUMN_NAME = 'id'`
  );
  const hasId = new Set(withId.map((r) => r.table));

  const refs: PdfRef[] = [];
  const seen = new Set<string>();
  for (const { table, column } of columns) {
    const idExpr = hasId.has(table) ? "CAST(`id` AS CHAR)" : "NULL";
    const rows: { id: string | null; v: unknown }[] = await prisma.$queryRawUnsafe(
      `SELECT ${idExpr} AS id, CAST(\`${column}\` AS CHAR) AS v
         FROM \`${table}\`
        WHERE LOWER(CAST(\`${column}\` AS CHAR)) LIKE '%.pdf%'`
    );
    for (const { id, v } of rows) {
      // JSON columns may hold escaped slashes ("https:\/\/…").
      const text = String(v ?? "").replace(/\\\//g, "/");
      for (const match of text.matchAll(PDF_URL_RE)) {
        const url = match[0];
        const dedupe = `${table}|${column}|${id}|${url}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        refs.push({ table, column, id: id == null ? null : String(id), url, key: keyFor(url, bucket, region) });
      }
    }
  }
  return { columnsScanned: columns.length, refs };
};
