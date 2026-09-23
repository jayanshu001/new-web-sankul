import { format } from "fast-csv";

/**
 * Stream pre-built rows through `fast-csv` into a single CSV string.
 *
 * Each row is an array of cells (already mapped from the report's column spec);
 * `headers` is written first. Rows arrive in **batches** (from a keyset iterator)
 * so the full result set is never materialized at once — the report exporters page
 * through lakhs of rows and feed one batch at a time.
 *
 * fast-csv handles RFC-4180 quoting/escaping (fields containing `,` `"` or newlines
 * are quoted, embedded `"` doubled), `\n` row delimiter, and no trailing newline —
 * byte-identical to the hand-rolled escaper this replaced.
 */
export async function buildCsvFromRowBatches(
  headers: (string | number)[],
  rowBatches: AsyncIterable<(string | number)[][]>,
): Promise<string> {
  const stream = format({ headers: false });
  const chunks: Buffer[] = [];
  const done = new Promise<void>((resolve, reject) => {
    stream.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
  stream.write(headers);
  for await (const batch of rowBatches) {
    for (const row of batch) stream.write(row);
  }
  stream.end();
  await done;
  return Buffer.concat(chunks).toString("utf8");
}

// IST offset applied to export timestamps. Timestamps are STORED as IST already
// (see the IST-in-DB migration), but a Date read back is a UTC instant, so we
// shift by +5:30 and read the wall-clock parts off the shifted value with the
// getUTC* accessors — that avoids depending on the server's local TZ.
const IST_OFFSET_MS = 330 * 60_000;
const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * `YYYY-MM-DD HH:mm:ss` in IST for a report/export cell; "" for null, undefined
 * or an unparseable value (an export column must never render "Invalid Date").
 *
 * Was copy-pasted into six report services; this is that exact implementation.
 * The admin-subscription copy typed `d` as `Date | null | undefined` while the
 * rest allowed `string` too — widened here to the union that already worked,
 * since the body has always gone through `new Date(d)`.
 */
export const fmtExportDate = (d: Date | string | null | undefined): string => {
  if (!d) return "";
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return "";
  const s = new Date(t.getTime() + IST_OFFSET_MS);
  return `${s.getUTCFullYear()}-${pad2(s.getUTCMonth() + 1)}-${pad2(s.getUTCDate())} ${pad2(s.getUTCHours())}:${pad2(s.getUTCMinutes())}:${pad2(s.getUTCSeconds())}`;
};
