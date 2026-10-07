// CSV export: streams row batches into one CSV string; export date formatting.
import { format } from "fast-csv";

/**
 * Streams row batches (from a keyset iterator) through `fast-csv` into one CSV
 * string, headers first. RFC-4180 quoting, `\n` delimiter, no trailing newline.
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

// A Date read back is a UTC instant, so shift +5:30 and read the parts with
// getUTC* to avoid depending on the server's local TZ.
const IST_OFFSET_MS = 330 * 60_000;
const pad2 = (n: number): string => String(n).padStart(2, "0");

/** `YYYY-MM-DD HH:mm:ss` in IST; "" for nullish or unparseable input (never "Invalid Date"). */
export const fmtExportDate = (d: Date | string | null | undefined): string => {
  if (!d) return "";
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return "";
  const s = new Date(t.getTime() + IST_OFFSET_MS);
  return `${s.getUTCFullYear()}-${pad2(s.getUTCMonth() + 1)}-${pad2(s.getUTCDate())} ${pad2(s.getUTCHours())}:${pad2(s.getUTCMinutes())}:${pad2(s.getUTCSeconds())}`;
};
