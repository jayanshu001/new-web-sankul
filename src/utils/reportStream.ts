// src/utils/reportStream.ts
//
// Bounded-memory report writer. Given a report "source" (its header row + an
// async-iterable of row batches, already mapped from the report's column spec),
// this streams the ENTIRE result set into a Writable as CSV or XLSX WITHOUT ever
// holding the whole file in memory.
//
// This is the piece that makes lakhs-of-rows exports safe: the async export worker
// pipes the source straight into a multipart upload to Spaces (see
// utils/exportStorage.ts → createExportUpload), so peak memory is one keyset batch
// of DB rows + one in-flight upload part (~5 MB) — flat regardless of row count.
//
// CSV uses fast-csv (RFC-4180 quoting, byte-identical to the sync buildCsvFromRowBatches).
// XLSX uses ExcelJS's streaming WorkbookWriter (worksheet model is flushed to the
// stream as rows are added, never kept resident) — same options the sync builders use
// (useStyles/useSharedStrings false, column width) so output matches the sync endpoints.

import { format as csvFormat } from "fast-csv";
import ExcelJS from "exceljs";
import type { Writable } from "node:stream";

export type ReportFormat = "csv" | "excel";

export interface ReportSource {
  /** XLSX worksheet name (ignored for CSV). */
  worksheetName: string;
  /** XLSX column width (ignored for CSV). Defaults to 22 to match the sync builders. */
  columnWidth?: number;
  /** Header cells, written as the first row. */
  headers: (string | number)[];
  /** Pre-mapped row batches (each batch is an array of cell-arrays). */
  rowBatches: AsyncIterable<(string | number)[][]>;
  /**
   * Optional exact row total (a COUNT with the same filters). When present the
   * worker reports true `rowsWritten / total` progress; when absent it falls back
   * to a monotonic ramp. Runs once, before streaming.
   */
  countTotal?: () => Promise<number>;
}

// Called after each batch is written, with the cumulative rows-written so far. The
// worker uses it to persist live progress. Awaited, so all progress writes settle
// before the stream resolves (no race with the terminal "ready" write).
export type OnProgress = (rowsWritten: number) => void | Promise<void>;

/**
 * Write `source` into `out` in the requested format. Resolves with the number of
 * data rows written (excluding the header). `out` is ended by this function
 * (fast-csv pipe / WorkbookWriter.commit both end the destination stream), which
 * is what signals a streaming upload that the body is complete. `onProgress` (if
 * given) fires once per batch with the running row count.
 */
export async function streamReportToWritable(
  source: ReportSource,
  format: ReportFormat,
  out: Writable,
  onProgress?: OnProgress
): Promise<number> {
  return format === "csv" ? streamCsv(source, out, onProgress) : streamXlsx(source, out, onProgress);
}

// Resolve on 'drain', reject on 'error' — so a slow/broken downstream (S3) never
// deadlocks the writer and surfaces the error to the worker.
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
  // fast-csv formats rows and pushes into `out`; when csv ends it ends `out`.
  csv.pipe(out);

  const write = async (row: (string | number)[]): Promise<void> => {
    // Respect backpressure: only pause when the pipe's buffer is full.
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
  // Wait until every formatted byte has been handed to `out` before returning.
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
  // WorkbookWriter.commit() finalizes the zip and ends `out`.
  await wb.commit();
  return count;
}
