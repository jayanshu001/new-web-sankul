// PDF upload progress: admin Socket.io namespace streaming per-job and batch-done events.
import { Socket, Namespace } from "socket.io";
import { verifyAccessToken } from "../utils/jwtSigner";
import { io } from "./livechat.socket";
import logger from "../utils/logger";

// PDF-upload job lifecycle status (mirrors ws_pdf_upload_job.status).
type PdfUploadJobStatus = "queued" | "in_progress" | "completed" | "failed";

// Admin live progress for PDF upload batches: a namespace on the shared Socket.io
// server from initLiveChatSocket(), not a second server (two on the same path would
// collide). The default namespace takes customer tokens; `/admin/pdf-uploads` has its
// own admin-only guard. Admins join a room per batchId and get `pdf_job_update` per job
// state change and `pdf_batch_done` at the end, emitted by the BullMQ worker
// (pdfUpload.scheduler.ts) through the helpers below.

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

/** Pushed on every job state change; the PdfUploadJob fields the admin UI renders. */
export interface PdfJobUpdate {
  batchId: string;
  jobId: string; // also the BullMQ jobId
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
 * Must be called after initLiveChatSocket(), which creates `io` and attaches the shared
 * Redis adapter, so emits reach admins connected to a different pod than the worker.
 */
export function initPdfProgressSocket(): void {
  if (!io) {
    logger.error(
      "initPdfProgressSocket called before initLiveChatSocket — Socket.io server not ready."
    );
    return;
  }

  nsp = io.of(NAMESPACE);

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

export function emitPdfJobUpdate(update: PdfJobUpdate): void {
  if (!nsp) return;
  nsp.to(pdfBatchRoom(update.batchId)).emit("pdf_job_update", update);
}

export function emitPdfBatchDone(summary: PdfBatchSummary): void {
  if (!nsp) return;
  nsp.to(pdfBatchRoom(summary.batchId)).emit("pdf_batch_done", summary);
}
