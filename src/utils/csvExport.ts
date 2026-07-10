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
