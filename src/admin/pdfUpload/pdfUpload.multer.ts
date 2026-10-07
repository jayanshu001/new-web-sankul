// Ebook PDF upload: multer disk-staging middleware (PDF only, 500MB cap).
// Stages the PDF on local temp disk (not memory, not S3) so a large book can't
// blow the heap and the BullMQ worker can stream it to Spaces after the request returns.

import multer from "multer";
import path from "path";
import os from "os";
import fs from "fs";
import { randomUUID } from "crypto";

const STAGE_ROOT = path.join(os.tmpdir(), "ws-pdf-uploads");

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdir(STAGE_ROOT, { recursive: true }, (err) =>
      cb(err, STAGE_ROOT)
    );
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".pdf";
    cb(null, `${randomUUID()}${ext}`);
  },
});

const PDF_MAX_BYTES = 500 * 1024 * 1024;

const pdfOnly: multer.Options["fileFilter"] = (_req, file, cb) => {
  const extOk = /\.pdf$/i.test(path.extname(file.originalname));
  const mimeOk = /^application\/pdf$/i.test(file.mimetype);
  if (extOk && mimeOk) return cb(null, true);
  cb(new Error("Only PDF files are allowed."));
};

export const uploadSinglePdfToDisk = multer({
  // multer 2.x decodes names as latin1 by default, mojibaking Gujarati/Hindi
  // file names. Mirrors MULTER_UTF8 in middlewares/upload.ts.

  defParamCharset: "utf8",
  storage,
  limits: { fileSize: PDF_MAX_BYTES, files: 1 },
  fileFilter: pdfOnly,
}).single("file");
