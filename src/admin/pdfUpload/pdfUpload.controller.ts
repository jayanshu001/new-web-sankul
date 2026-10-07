// Ebook PDF upload: HTTP handlers to queue an upload and fetch batch status.
// Single-PDF ebook upload (multipart, not presigned). The file is staged to disk
// here; the BullMQ worker (pdfUpload.scheduler.ts) uploads it to Spaces and
// attaches it, reporting progress via socket/pdf-progress.socket.ts.

import { Request, Response } from "express";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { success, failure } from "../../utils/httpResponse";
import { enqueuePdfUploadJob } from "./pdfUpload.scheduler";
import { pdfBatchRoom } from "../../socket/pdf-progress.socket";
import {
  createJobSql,
  getBatchJobsSql,
  ebookExistsSql,
  setEbookUploadStatusSql,
  parsePdfId,
} from "../../modules/pdf-upload/pdf-upload.service";
import logger from "../../utils/logger";

// Returns the batchId (the Socket.io room key) so the client can join_pdf_batch.
export const uploadEbookPdf = asyncHandler(
  async (req: Request, res: Response) => {
    const traceId = (req as any).traceId;
    const adminId = req.user?.id;
    const ebookId = String(req.params.ebookId || "");
    const file = req.file as Express.Multer.File | undefined;

    const cleanup = () =>
      file ? fs.unlink(file.path).catch(() => {}) : Promise.resolve();

    if (!adminId) {
      await cleanup();
      return failure(res, "Unauthorized.", 401);
    }

    if (parsePdfId(ebookId) == null) {
      await cleanup();
      return failure(res, "Invalid ebookId.", 400);
    }
    if (!file) {
      return failure(res, "No PDF uploaded (field: file).", 422);
    }

    const target = String(req.body?.target || "bookUrl");
    if (target !== "bookUrl" && target !== "demoUrl") {
      await cleanup();
      return failure(res, "target must be 'bookUrl' or 'demoUrl'.", 422);
    }

    const ebookFound = await ebookExistsSql(ebookId);
    if (!ebookFound) {
      await cleanup();
      return failure(res, "Ebook not found.", 404);
    }

    const batchId = randomUUID();
    // The job `_id` doubles as the BullMQ jobId so enqueue stays idempotent.
    const job: any = await createJobSql({
      batchId,
      index: 0,
      uploadedBy: adminId,
      ebookId,
      targetField: target,
      fileName: file.originalname,
      tempPath: file.path,
      fileSize: file.size,
    });

    await enqueuePdfUploadJob(String(job._id));

    // Persisted so the admin list shows "queued" after a refresh, not only over the socket.
    await setEbookUploadStatusSql(ebookId, target, { status: "queued", progress: 0 });

    logger.info("Ebook PDF upload queued", {
      traceId,
      adminId,
      ebookId,
      target,
      batchId,
      jobId: String(job._id),
    });

    return success(
      res,
      {
        batchId,
        socket: {
          namespace: "/admin/pdf-uploads",
          room: pdfBatchRoom(batchId),
          joinEvent: "join_pdf_batch",
        },
        job: {
          jobId: String(job._id),
          index: 0,
          fileName: job.fileName,
          ebookId,
          target,
          status: job.status,
          progress: job.progress,
        },
      },
      "PDF upload queued.",
      201
    );
  }
);

// Snapshot the admin fetches on (re)connect, before live socket events resume.

export const getPdfUploadBatch = asyncHandler(
  async (req: Request, res: Response) => {
    const batchId = String(req.params.batchId || "");
    if (!batchId) return failure(res, "batchId required.", 400);

    const jobs = await getBatchJobsSql(batchId);

    if (!jobs.length) return failure(res, "Batch not found.", 404);

    const completed = jobs.filter((j) => j.status === "completed").length;
    const failed = jobs.filter((j) => j.status === "failed").length;

    return success(
      res,
      {
        batchId,
        total: jobs.length,
        completed,
        failed,
        inProgress: jobs.filter((j) => j.status === "in_progress").length,
        queued: jobs.filter((j) => j.status === "queued").length,
        done: completed + failed >= jobs.length,
        jobs: jobs.map((j: any) => ({
          jobId: String(j._id),
          index: j.index,
          fileName: j.fileName,
          ebookId: String(j.ebookId),
          status: j.status,
          progress: j.progress,
          fileUrl: j.fileUrl ?? null,
          failureReason: j.failureReason ?? null,
          startedAt: j.startedAt ?? null,
          finishedAt: j.finishedAt ?? null,
        })),
      },
      "Batch status."
    );
  }
);
