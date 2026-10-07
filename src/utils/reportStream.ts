// Report stream: bounded-memory writer that streams a header row + async row batches into a
// Writable as CSV or XLSX without holding the file in memory. The export worker
// pipes it into a multipart Spaces upload, so peak memory is one DB batch plus
// one upload part regardless of row count. Options match the sync builders so
// output is byte-identical to the sync endpoints.

import { format as csvFormat } from "fast-csv";
import ExcelJS from "exceljs";
import type { Writable } from "node:stream";

export type ReportFormat = "csv" | "excel";

export interface ReportSource {
  /** XLSX only. */
  worksheetName: string;
  /** XLSX only. Defaults to 22 to match the sync builders. */
  columnWidth?: number;
  headers: (string | number)[];
  rowBatches: AsyncIterable<(string | number)[][]>;
  /**
   * Exact row total (COUNT with the same filters) for true progress; without it
   * the worker falls back to a monotonic ramp. Runs once, before streaming.
   */
  countTotal?: () => Promise<number>;
}

// Called per batch with cumulative rows written. Awaited so progress writes settle
// before the stream resolves (no race with the terminal "ready" write).
export type OnProgress = (rowsWritten: number) => void | Promise<void>;

/**
 * Resolves with the number of data rows written (excluding the header). Ends
 * `out`, which is what signals a streaming upload that the body is complete.
 */
export async function streamReportToWritable(
  source: ReportSource,
  format: ReportFormat,
  out: Writable,
  onProgress?: OnProgress
): Promise<number> {
  return format === "csv" ? streamCsv(source, out, onProgress) : streamXlsx(source, out, onProgress);
}

// Rejects on 'error' so a broken downstream (S3) never deadlocks the writer.
function drain(stream: NodeJS.WritableStream): Promise<void> {
  return new Promise((resolve, reject) => {
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onErr = (e: Error) => {
      cleanup();
      reject(e);
    };
    const cleanup = () => {
      stream.off("drain", onDrain);
      stream.off("error", onErr);
    };
    stream.once("drain", onDrain);
    stream.once("error", onErr);
  });
}

async function streamCsv(source: ReportSource, out: Writable, onProgress?: OnProgress): Promise<number> {
  const csv = csvFormat({ headers: false });
  csv.pipe(out);

  const write = async (row: (string | number)[]): Promise<void> => {
    if (!csv.write(row)) await drain(csv);
  };

  let count = 0;
  await write(source.headers);
  for await (const batch of source.rowBatches) {
    for (const row of batch) {
      await write(row);
      count++;
    }
    if (onProgress) await onProgress(count);
  }
  csv.end();
  await new Promise<void>((resolve, reject) => {
    csv.once("end", resolve);
    csv.once("error", reject);
    out.once("error", reject);
  });
  return count;
}

async function streamXlsx(source: ReportSource, out: Writable, onProgress?: OnProgress): Promise<number> {
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: out,
    useStyles: false,
    useSharedStrings: false,
  });
  const ws = wb.addWorksheet(source.worksheetName);
  ws.columns = source.headers.map((h) => ({
    header: String(h),
    key: String(h),
    width: source.columnWidth ?? 22,
  }));

  let count = 0;
  for await (const batch of source.rowBatches) {
    for (const row of batch) {
      ws.addRow(row).commit();
      count++;
    }
    if (onProgress) await onProgress(count);
  }
  ws.commit();
  await wb.commit();
  return count;
}
