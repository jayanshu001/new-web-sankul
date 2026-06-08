// Disk-staging multer for the single-PDF upload pipeline. Unlike the S3 uploaders
// in middlewares/upload.ts, this writes the incoming bytes to LOCAL temp disk —
// the BullMQ worker later streams the staged file to Spaces. We stage to disk
// (not memory) so a large book PDF can't blow the heap, and so the worker can
// process it after the HTTP request has already returned.

import multer from "multer";
import path from "path";
import os from "os";
import fs from "fs";
import { randomUUID } from "crypto";

// Per-batch temp dir under the OS tmp root. Created lazily on first file.
const STAGE_ROOT = path.join(os.tmpdir(), "ws-pdf-uploads");

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdir(STAGE_ROOT, { recursive: true }, (err) =>
      cb(err, STAGE_ROOT)
    );
  },
  filename: (_req, file, cb) => {
    // Unique on-disk name; original name is preserved on the job row.
    const ext = path.extname(file.originalname) || ".pdf";
    cb(null, `${randomUUID()}${ext}`);
  },
});

const PDF_MAX_BYTES = 500 * 1024 * 1024; // 500 MB per book PDF

const pdfOnly: multer.Options["fileFilter"] = (_req, file, cb) => {
  const extOk = /\.pdf$/i.test(path.extname(file.originalname));
  const mimeOk = /^application\/pdf$/i.test(file.mimetype);
  if (extOk && mimeOk) return cb(null, true);
  cb(new Error("Only PDF files are allowed."));
};

// One PDF under field `file` — used by the Edit-Ebook screen's Book/Demo PDF
// field. Staged to disk, then processed by the BullMQ worker with live progress.
export const uploadSinglePdfToDisk = multer({
  storage,
  limits: { fileSize: PDF_MAX_BYTES, files: 1 },
  fileFilter: pdfOnly,
}).single("file");
