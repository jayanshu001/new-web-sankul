/**
 * SQL (Prisma) port of the admin PDF-upload job lifecycle row CRUD. Flag:
 * `pdf-upload`. Backs ws_pdf_upload_job (model PdfUploadJob).
 *
 * SCOPE — only the ws_pdf_upload_job ROW CRUD moves here:
 *   - create the batch job row
 *   - read a single row by id (worker) / a whole batch (controller + worker)
 *   - update status / progress / fileUrl / failureReason / timestamps
 *   - batch terminal-state counts
 *
 * EXPLICITLY UNCHANGED (still Mongo / Redis / Socket.io):
 *   - BullMQ enqueue + worker (pdfUpload.scheduler.ts)
 *   - Socket.io progress emits (pdf-progress.socket.ts)
 *
 * EBOOK-SIDE WRITE (C7) — now on SQL too:
 *   ws_ebook now has book_file_name/demo_file_name + book_upload_status/
 *   demo_upload_status + book_upload_progress/demo_upload_progress, alongside the
 *   existing book_url/demo_url. setEbookUploadStatusSql writes those columns under
 *   the `pdf-upload` flag, keyed by the SQL int ebookId carried on the job row.
 *   The `target` ("bookUrl"|"demoUrl") + `set` keys are the SAME Mongo field
 *   names the scheduler already uses; we translate `demoUrl`→book_demo_url
 *   (Prisma bookDemoUrl) on the way in.
 *
 * Id mapping vs the Mongo model:
 *   Mongo `index`        → SQL `idx`
 *   Mongo `uploadedBy`   (admin ObjectId string) → SQL `uploadedBy` int via parse
 *   Mongo `ebookId`      (ObjectId)              → SQL `ebookId` int via parse
 *   Mongo `_id`          (ObjectId string)       → SQL `id` int (stringified out)
 *
 * Admin auth stays on Mongo, so `uploadedBy` may not be an int — when it can't
 * be parsed we store null (the column is nullable) rather than fail the upload.
 */
import { isMysqlModule } from "../../config/migration";
import { prisma } from "../../config/prisma";

export const PDF_UPLOAD_MODULE = "pdf-upload";
export const isPdfUploadMysql = (): boolean => isMysqlModule(PDF_UPLOAD_MODULE);

export const parsePdfId = (id: string | number | null | undefined): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Shape a ws_pdf_upload_job row to the same fields the rest of the pipeline read
 * off the Mongo doc — notably `_id` (stringified) and `index` (← `idx`), plus
 * `ebookId` stringified. `fileSize` is BigInt on SQL; coerced to Number so the
 * S3 ContentLength stays a plain number (book PDFs ≤ 500MB fit in a JS number).
 */
export const toJobRow = (r: any): any => ({
  _id: String(r.id),
  id: r.id,
  batchId: r.batchId,
  index: r.idx,
  uploadedBy: r.uploadedBy ?? null,
  ebookId: r.ebookId != null ? String(r.ebookId) : null,
  targetField: r.targetField,
  fileName: r.fileName,
  tempPath: r.tempPath,
  fileSize: r.fileSize != null ? Number(r.fileSize) : 0,
  status: r.status,
  progress: r.progress ?? 0,
  fileUrl: r.fileUrl ?? null,
  failureReason: r.failureReason ?? null,
  startedAt: r.startedAt ?? null,
  finishedAt: r.finishedAt ?? null,
  createdAt: r.createdAt ?? null,
  updatedAt: r.updatedAt ?? null,
});

export interface CreatePdfJobInput {
  batchId: string;
  index: number;
  uploadedBy?: string | number | null;
  ebookId: string;
  targetField: string;
  fileName: string;
  tempPath: string;
  fileSize: number;
}

/** Create one ws_pdf_upload_job row (status "queued", progress 0). */
export const createJobSql = async (input: CreatePdfJobInput): Promise<any> => {
  const now = new Date();
  const row = await prisma.pdfUploadJob.create({
    data: {
      batchId: input.batchId,
      idx: input.index,
      uploadedBy: parsePdfId(input.uploadedBy),
      ebookId: parsePdfId(input.ebookId),
      targetField: input.targetField,
      fileName: input.fileName,
      tempPath: input.tempPath,
      fileSize: BigInt(Math.max(0, Math.trunc(input.fileSize || 0))),
      status: "queued",
      progress: 0,
      createdAt: now,
      updatedAt: now,
    },
  });
  return toJobRow(row);
};

/** Single row by SQL id (the jobRecordId used as the BullMQ jobId). */
export const getJobByIdSql = async (jobRecordId: string | number): Promise<any | null> => {
  const id = parsePdfId(jobRecordId);
  if (!id) return null;
  const row = await prisma.pdfUploadJob.findUnique({ where: { id } });
  return row ? toJobRow(row) : null;
};

/** All rows in a batch, ordered by idx (ascending) — the Socket.io room view. */
export const getBatchJobsSql = async (batchId: string): Promise<any[]> => {
  const rows = await prisma.pdfUploadJob.findMany({
    where: { batchId },
    orderBy: { idx: "asc" },
  });
  return rows.map(toJobRow);
};

/**
 * Patch a job row. Accepts the Mongo-style fields the pipeline sets; maps
 * `index`→`idx` if present. Returns the updated row (Mongo-shaped) or null.
 */
export const updateJobSql = async (
  jobRecordId: string | number,
  patch: {
    status?: string;
    progress?: number;
    fileUrl?: string | null;
    failureReason?: string | null;
    startedAt?: Date | null;
    finishedAt?: Date | null;
  }
): Promise<any | null> => {
  const id = parsePdfId(jobRecordId);
  if (!id) return null;
  const data: any = { updatedAt: new Date() };
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.progress !== undefined) data.progress = patch.progress;
  if (patch.fileUrl !== undefined) data.fileUrl = patch.fileUrl;
  if (patch.failureReason !== undefined) data.failureReason = patch.failureReason;
  if (patch.startedAt !== undefined) data.startedAt = patch.startedAt;
  if (patch.finishedAt !== undefined) data.finishedAt = patch.finishedAt;
  try {
    const row = await prisma.pdfUploadJob.update({ where: { id }, data });
    return toJobRow(row);
  } catch {
    return null; // row vanished
  }
};

/** Terminal-state counts for a batch (drives "is this batch fully done?"). */
export const batchCountsSql = async (
  batchId: string
): Promise<{ total: number; completed: number; failed: number }> => {
  const [total, completed, failed] = await Promise.all([
    prisma.pdfUploadJob.count({ where: { batchId } }),
    prisma.pdfUploadJob.count({ where: { batchId, status: "completed" } }),
    prisma.pdfUploadJob.count({ where: { batchId, status: "failed" } }),
  ]);
  return { total, completed, failed };
};

/**
 * Boot rehydrate source — rows still queued/in_progress. in_progress rows are
 * reset to queued (progress 0) first, mirroring the Mongo rehydrate. Returns the
 * ids (stringified) to re-enqueue.
 */
export const rehydrateRowsSql = async (): Promise<string[]> => {
  const rows = await prisma.pdfUploadJob.findMany({
    where: { status: { in: ["queued", "in_progress"] } },
    select: { id: true, status: true },
  });
  const ids: string[] = [];
  for (const row of rows) {
    if (row.status === "in_progress") {
      await prisma.pdfUploadJob
        .update({ where: { id: row.id }, data: { status: "queued", progress: 0, updatedAt: new Date() } })
        .catch(() => {});
    }
    ids.push(String(row.id));
  }
  return ids;
};

// ── ebook-side upload-status write (C7) ───────────────────────────────────────
// Mirrors src/admin/ebook/ebook.service.ts setEbookUploadStatus, but writes the
// ws_ebook columns. `ebookId` is the SQL int (the job row carries it). The
// `set` map uses the SAME Mongo field names the scheduler passes
// (bookUrl/demoUrl/bookFileName/demoFileName); we translate to Prisma fields:
//   bookUrl→bookUrl, demoUrl→bookDemoUrl, bookFileName→bookFileName,
//   demoFileName→demoFileName.

/** Does an ebook row exist for this SQL int id? */
export const ebookExistsSql = async (ebookId: string | number): Promise<boolean> => {
  const id = parsePdfId(ebookId);
  if (!id) return false;
  const row = await prisma.eBook.findFirst({ where: { id }, select: { id: true } });
  return !!row;
};

/**
 * Read the current url on an ebook's target slot (book_url / demo_url) so the
 * scheduler can delete the replaced file from Spaces after attaching the new one.
 * Returns null when the id is invalid / the row is gone.
 */
export const getEbookUrlSql = async (
  ebookId: string | number,
  target: "bookUrl" | "demoUrl"
): Promise<string | null> => {
  const id = parsePdfId(ebookId);
  if (!id) return null;
  const row = await prisma.eBook.findFirst({
    where: { id },
    select: { bookUrl: true, bookDemoUrl: true },
  });
  if (!row) return null;
  return (target === "demoUrl" ? row.bookDemoUrl : row.bookUrl) || null;
};

/** Translate the scheduler's Mongo-named `set` keys to Prisma ebook columns. */
const translateEbookSet = (set: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(set)) {
    if (k === "demoUrl") out.bookDemoUrl = v;
    else if (k === "bookUrl") out.bookUrl = v;
    else if (k === "bookFileName") out.bookFileName = v;
    else if (k === "demoFileName") out.demoFileName = v;
    // unknown keys are ignored — only the known file/url fields are persisted.
  }
  return out;
};

/**
 * Persist the upload lifecycle onto ws_ebook. `target` selects book vs demo
 * columns; `status` maps 1:1 (queued/processing/completed/failed — the scheduler
 * already maps "in_progress"→"processing" before calling). `progress` and the
 * resolved url/filename `set` are written when present. Returns false when the
 * ebook id is invalid / the row is gone (best-effort — never throws).
 */
export const setEbookUploadStatusSql = async (
  ebookId: string | number,
  target: "bookUrl" | "demoUrl",
  fields: { status: string; progress?: number; set?: Record<string, unknown> }
): Promise<boolean> => {
  const id = parsePdfId(ebookId);
  if (!id) return false;
  const prefix = target === "demoUrl" ? "demo" : "book";
  const data: Record<string, unknown> = {
    [`${prefix}UploadStatus`]: fields.status,
    ...(fields.set ? translateEbookSet(fields.set) : {}),
    updatedAt: new Date(),
  };
  if (fields.progress !== undefined) {
    data[`${prefix}UploadProgress`] = fields.progress;
  }
  try {
    await prisma.eBook.update({ where: { id }, data });
    return true;
  } catch {
    return false; // row vanished / invalid id
  }
};
