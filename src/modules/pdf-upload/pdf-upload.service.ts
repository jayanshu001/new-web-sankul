/**
 * PDF upload jobs: ws_pdf_upload_job row CRUD plus the ws_ebook upload-status write. BullMQ
 * (pdfUpload.scheduler.ts) and Socket.io progress (pdf-progress.socket.ts) live elsewhere.
 *
 * `uploadedBy` / `ebookId` are parsed to ints; an unparseable `uploadedBy` is stored
 * as null (nullable column) rather than failing the upload.
 */
import { prisma } from "../../config/prisma";
import { parsePositiveInt } from "../../utils/parseId";

export const parsePdfId = parsePositiveInt;

/**
 * Pipeline-facing row shape: `_id`/`ebookId` stringified, `index` ← `idx`. `fileSize`
 * is BigInt in SQL; coerced to Number for S3 ContentLength (PDFs ≤ 500MB fit).
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

/** `jobRecordId` is also the BullMQ jobId. */
export const getJobByIdSql = async (jobRecordId: string | number): Promise<any | null> => {
  const id = parsePdfId(jobRecordId);
  if (!id) return null;
  const row = await prisma.pdfUploadJob.findUnique({ where: { id } });
  return row ? toJobRow(row) : null;
};

/** Ordered by idx — the Socket.io room view. */
export const getBatchJobsSql = async (batchId: string): Promise<any[]> => {
  const rows = await prisma.pdfUploadJob.findMany({
    where: { batchId },
    orderBy: { idx: "asc" },
  });
  return rows.map(toJobRow);
};

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

/** Boot rehydrate: resets in_progress rows to queued (progress 0) and returns every pending id. */
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

// `set` keys use the scheduler's names (bookUrl/demoUrl/bookFileName/demoFileName);
// `demoUrl` maps to the Prisma field `bookDemoUrl`.
export const ebookExistsSql = async (ebookId: string | number): Promise<boolean> => {
  const id = parsePdfId(ebookId);
  if (!id) return false;
  const row = await prisma.eBook.findFirst({ where: { id }, select: { id: true } });
  return !!row;
};

/**
 * Current url on the target slot, so the scheduler can delete the replaced file
 * from Spaces. Null when the id is invalid or the row is gone.
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

const translateEbookSet = (set: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(set)) {
    if (k === "demoUrl") out.bookDemoUrl = v;
    else if (k === "bookUrl") out.bookUrl = v;
    else if (k === "bookFileName") out.bookFileName = v;
    else if (k === "demoFileName") out.demoFileName = v;
    // Unknown keys are ignored.
  }
  return out;
};

/**
 * `status` is written as-is (the scheduler already maps "in_progress"→"processing").
 * Best-effort: returns false when the id is invalid or the row is gone, never throws.
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
