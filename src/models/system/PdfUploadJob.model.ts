import { Schema, model, Document, Types } from "mongoose";

// One row per uploaded PDF. The admin uploads one PDF for one ebook (the
// Edit-Ebook screen); it becomes one PdfUploadJob + one BullMQ job. The worker
// runs at concurrency 1, so if several uploads are in flight they process one
// at a time rather than competing. `batchId` is a unique per-upload id that
// doubles as the Socket.io room key. The lifecycle here is the source of truth
// the admin UI renders; BullMQ is just the runner.
export type PdfUploadJobStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "failed";

// Which eBook field the uploaded PDF URL is written to. The Edit-Ebook screen
// has both a "Book PDF" (bookUrl) and a "Demo PDF" (demoUrl) slot.
export type PdfUploadTargetField = "bookUrl" | "demoUrl";

export interface IPdfUploadJob extends Document {
  // Groups the jobs from a single multipart upload so the admin can watch the
  // whole batch's progress in one Socket.io room (pdf_batch:<batchId>).
  batchId: string;
  // Position within the batch (0-based) — drives the deterministic processing
  // order and the "item 3 of N" label.
  index: number;
  // Who kicked off the upload (admin user id from the JWT).
  uploadedBy: string;

  // The ebook this PDF is attached to once the upload succeeds, and which
  // field on it receives the URL (bookUrl by default, or demoUrl).
  ebookId: Types.ObjectId;
  targetField: PdfUploadTargetField;

  // Original client filename + the temp local path the multipart bytes were
  // staged to. The worker streams from tempPath → Spaces, then unlinks it.
  fileName: string;
  tempPath: string;
  fileSize: number;

  status: PdfUploadJobStatus;
  // 0–100. Mirrors BullMQ job.progress so a reconnecting admin can render the
  // bar without waiting for the next live event.
  progress: number;

  // Set on success — the public Spaces URL written to ebook.bookUrl.
  fileUrl?: string | null;
  // Set on terminal failure (retries exhausted).
  failureReason?: string | null;

  startedAt?: Date | null;
  finishedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const pdfUploadJobSchema = new Schema<IPdfUploadJob>(
  {
    batchId: { type: String, required: true, index: true },
    index: { type: Number, required: true },
    uploadedBy: { type: String, required: true },

    ebookId: { type: Schema.Types.ObjectId, ref: "Ebook", required: true },
    targetField: {
      type: String,
      enum: ["bookUrl", "demoUrl"],
      default: "bookUrl",
    },

    fileName: { type: String, required: true },
    tempPath: { type: String, required: true },
    fileSize: { type: Number, required: true },

    status: {
      type: String,
      enum: ["queued", "in_progress", "completed", "failed"],
      default: "queued",
      index: true,
    },
    progress: { type: Number, default: 0, min: 0, max: 100 },

    fileUrl: { type: String, default: null },
    failureReason: { type: String, default: null },

    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Batch listing in deterministic order.
pdfUploadJobSchema.index({ batchId: 1, index: 1 });

export const PdfUploadJob = model<IPdfUploadJob>(
  "PdfUploadJob",
  pdfUploadJobSchema,
  "ws_pdf_upload_jobs"
);
