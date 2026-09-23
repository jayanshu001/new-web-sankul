// src/admin/pdfUpload/pdfUpload.controller.ts
//
// Admin single-PDF upload → BullMQ pipeline. The admin POSTs one PDF (multipart,
// NOT presigned) for one eBook from the Edit-Ebook screen. The bytes are staged
// to local temp disk here; the actual upload-to-Spaces + attach-to-ebook happens
// in the BullMQ worker (pdfUpload.scheduler.ts) so the admin can watch a clean
// queued → in_progress → completed run over a Socket.io room. See
// socket/pdf-progress.socket.ts for the live channel.

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

// POST /api/v1/admin/ebooks/:ebookId/pdf  (Edit-Ebook screen)
// multipart: file (one PDF) + optional `target` ("bookUrl" | "demoUrl").
// Stages the file, creates one job + a unique batchId (the Socket.io room key),
// enqueues it, and returns the batchId so the client can join_pdf_batch and
// watch the queued → in_progress → completed run.
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

    // The ebookId path param is a SQL int (the job row + ebook columns are
    // keyed by it).
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
    // The ws_pdf_upload_job ROW + the ebook-side upload-status write both run on
    // SQL (ws_ebook has the upload-status / file-name columns). BullMQ enqueue +
    // Socket.io are untouched. The job `_id` is the stringified SQL int id, used
    // as the BullMQ jobId so enqueue stays idempotent.
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

    // Persist the "queued" state onto the ebook so the admin list reflects it
    // immediately (and after a refresh), not just over the per-session socket.
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

// GET /api/v1/admin/ebooks/pdf-jobs/:batchId
// Snapshot of an upload's current state — the admin calls this on (re)connect to
// render the row before live socket events resume.
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
