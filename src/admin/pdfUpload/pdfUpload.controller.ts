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
import mongoose from "mongoose";
import { randomUUID } from "crypto";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { success, failure } from "../../utils/httpResponse";
import { PdfUploadJob } from "../../models/system/PdfUploadJob.model";
import { Ebook } from "../../models/ebook/Ebook.model";
import { enqueuePdfUploadJob } from "./pdfUpload.scheduler";
import { setEbookUploadStatus } from "../ebook/ebook.service";
import { pdfBatchRoom } from "../../socket/pdf-progress.socket";
import logger from "../../utils/logger";

const isObjectId = (s?: string): boolean =>
  !!s && /^[0-9a-fA-F]{24}$/.test(s);

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
    if (!isObjectId(ebookId)) {
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

    const ebook = await Ebook.findById(ebookId).select("_id").lean();
    if (!ebook) {
      await cleanup();
      return failure(res, "Ebook not found.", 404);
    }

    const batchId = randomUUID();
    const job = await PdfUploadJob.create({
      batchId,
      index: 0,
      uploadedBy: adminId,
      ebookId: new mongoose.Types.ObjectId(ebookId),
      targetField: target,
      fileName: file.originalname,
      tempPath: file.path,
      fileSize: file.size,
      status: "queued",
      progress: 0,
    });

    await enqueuePdfUploadJob(String(job._id));

    // Persist the "queued" state onto the ebook so the admin list reflects it
    // immediately (and after a refresh), not just over the per-session socket.
    await setEbookUploadStatus(ebookId, target, { status: "queued", progress: 0 });

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

    const jobs = await PdfUploadJob.find({ batchId })
      .sort({ index: 1 })
      .select(
        "_id index fileName ebookId status progress fileUrl failureReason startedAt finishedAt"
      )
      .lean();

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
