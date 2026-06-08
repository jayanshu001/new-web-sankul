import { Socket, Namespace } from "socket.io";
import { verifyAccessToken } from "../utils/jwtSigner";
import { io } from "./livechat.socket";
import logger from "../utils/logger";
import type { PdfUploadJobStatus } from "../models/system/PdfUploadJob.model";

// Admin-side live progress for PDF upload batches. This is a NAMESPACE on the
// shared Socket.io server created by initLiveChatSocket() — not a second server
// (two Socket.io servers on the same httpServer/path would collide). The
// default namespace authenticates customer tokens; this `/admin/pdf-uploads`
// namespace has its own `.use()` guard accepting only ADMIN tokens. The shared
// server already has the Redis adapter attached, so emits fan out across pods.
//
// Admins join a room per batchId and receive a `pdf_job_update` event on every
// job state change, plus a `pdf_batch_done` event when the batch finishes. The
// events are emitted by the BullMQ worker (pdfUpload.scheduler.ts) via the
// helpers below, so the worker never imports socket.io internals directly.

const NAMESPACE = "/admin/pdf-uploads";

let nsp: Namespace | null = null;

export function pdfBatchRoom(batchId: string): string {
  return `pdf_batch:${batchId}`;
}

// Roles allowed to watch upload progress — same set that can issue uploads.
const ALLOWED_ROLES = new Set(["admin", "super_admin", "editor"]);

interface AdminSocket extends Socket {
  adminId?: string;
  adminRole?: string;
}

/**
 * The payload pushed on every job state change. Mirrors the persisted
 * PdfUploadJob fields the admin UI needs to render a row.
 */
export interface PdfJobUpdate {
  batchId: string;
  jobId: string; // PdfUploadJob._id (also the BullMQ jobId)
  index: number;
  fileName: string;
  ebookId: string;
  status: PdfUploadJobStatus;
  progress: number; // 0–100
  fileUrl?: string | null;
  failureReason?: string | null;
}

export interface PdfBatchSummary {
  batchId: string;
  total: number;
  completed: number;
  failed: number;
}

/**
 * Attach the admin PDF-progress namespace to the shared Socket.io server.
 * MUST be called AFTER initLiveChatSocket() (which creates `io` and attaches
 * the Redis adapter); the adapter is shared, so emits fan out across every pod
 * (the admin watching may be connected to a different pod than the worker that
 * ran the job).
 */
export function initPdfProgressSocket(): void {
  if (!io) {
    logger.error(
      "initPdfProgressSocket called before initLiveChatSocket — Socket.io server not ready."
    );
    return;
  }

  nsp = io.of(NAMESPACE);

  // Only admin tokens may connect.
  nsp.use((socket: AdminSocket, next) => {
    try {
      const token =
        (socket.handshake.auth?.token as string) ||
        (socket.handshake.headers?.authorization as string)?.replace("Bearer ", "");
      if (!token) return next(new Error("Authentication token required"));

      const decoded = verifyAccessToken<any>(token);
      const role = decoded?.role;
      if (decoded?.type !== "admin" || !ALLOWED_ROLES.has(role)) {
        return next(new Error("Admin access required"));
      }
      socket.adminId = decoded.id;
      socket.adminRole = role;
      next();
    } catch {
      next(new Error("Invalid or expired token"));
    }
  });

  nsp.on("connection", (socket: AdminSocket) => {
    logger.info("PDF-progress: admin connected", {
      socketId: socket.id,
      adminId: socket.adminId,
    });

    socket.on("join_pdf_batch", ({ batchId }: { batchId: string }) => {
      if (!batchId || typeof batchId !== "string") {
        socket.emit("error", { message: "batchId required" });
        return;
      }
      socket.join(pdfBatchRoom(batchId));
      socket.emit("joined_pdf_batch", { batchId });
    });

    socket.on("leave_pdf_batch", ({ batchId }: { batchId: string }) => {
      if (batchId) socket.leave(pdfBatchRoom(batchId));
    });
  });

  logger.info("Admin PDF-progress Socket.io namespace attached.", {
    namespace: NAMESPACE,
  });
}

/** Emit a single job's new state to everyone watching its batch. */
export function emitPdfJobUpdate(update: PdfJobUpdate): void {
  if (!nsp) return;
  nsp.to(pdfBatchRoom(update.batchId)).emit("pdf_job_update", update);
}

/** Emit the batch summary once the last job in a batch finishes. */
export function emitPdfBatchDone(summary: PdfBatchSummary): void {
  if (!nsp) return;
  nsp.to(pdfBatchRoom(summary.batchId)).emit("pdf_batch_done", summary);
}
