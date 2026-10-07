// Presigned uploads: direct-to-Spaces uploads for large files (eBook PDFs up to 500 MB),
// so the bytes never pass through this server. Flow: POST /admin/uploads/presign
// → client PUTs the raw bytes to `uploadUrl` with the same Content-Type → client
// saves `fileUrl` on the ebook. Browser PUTs need a Spaces CORS rule allowing the
// admin origin (docs/large-pdf-upload.md).

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import path from "path";
import { s3Config, DO_BUCKET, publicUrlFor } from "../middlewares/upload";
import { UPLOAD_FOLDERS } from "../config/uploadFolders";

// Long enough for 500 MB on ~3 Mbps (~22 min), short enough to limit URL leakage.
const PRESIGN_EXPIRY_SECONDS = 30 * 60;

// Spaces does not enforce this on a simple PUT; the real guardrail is the
// Content-Length pinned at sign time.
export const PRESIGN_MAX_BYTES = 500 * 1024 * 1024;

// Allowlist so presign is not an open relay for arbitrary keys/types.
const KINDS = {
  ebookPdf: {
    prefix: UPLOAD_FOLDERS.ebookFull,
    extPattern: /\.pdf$/i,
    mimePattern: /^application\/pdf$/i,
    maxBytes: PRESIGN_MAX_BYTES,
  },
  jobPreviousPaperPdf: {
    prefix: UPLOAD_FOLDERS.jobsPapers,
    extPattern: /\.pdf$/i,
    mimePattern: /^application\/pdf$/i,
    maxBytes: PRESIGN_MAX_BYTES,
  },
} as const;

export type PresignKind = keyof typeof KINDS;
export const PRESIGN_KINDS = Object.keys(KINDS) as PresignKind[];

export interface PresignInput {
  kind: PresignKind;
  fileName: string;
  contentType: string;
  fileSize: number; // bytes; pinned as Content-Length
}

export interface PresignResult {
  uploadUrl: string;
  fileUrl: string;
  key: string;
  expiresIn: number;
  requiredHeaders: Record<string, string>; // the client must send these on the PUT
}

const sanitizeName = (name: string) =>
  path
    .basename(name)
    .replace(/[^\w.\-]+/g, "_")
    .slice(-120); // keep the tail (extension) if the name is very long

/**
 * Validates kind, extension, mimetype and size, then signs a PUT URL pinned to
 * the declared Content-Type and Content-Length.
 */
export const buildPresignedUpload = async (
  input: PresignInput
): Promise<PresignResult> => {
  const cfg = KINDS[input.kind];
  if (!cfg) {
    throw new Error(`Invalid upload kind: ${input.kind}`);
  }

  const safeName = sanitizeName(input.fileName || "");
  if (!cfg.extPattern.test(safeName)) {
    throw new Error("Invalid file extension for this upload kind.");
  }
  if (!cfg.mimePattern.test(input.contentType || "")) {
    throw new Error("Invalid Content-Type for this upload kind.");
  }
  if (
    !Number.isFinite(input.fileSize) ||
    input.fileSize <= 0 ||
    input.fileSize > cfg.maxBytes
  ) {
    const mb = Math.round(cfg.maxBytes / (1024 * 1024));
    throw new Error(`fileSize must be between 1 byte and ${mb} MB.`);
  }

  // Random suffix avoids collisions for same-named files in the same ms.
  const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const key = `${cfg.prefix}/${unique}-${safeName}`;

  const command = new PutObjectCommand({
    Bucket: DO_BUCKET,
    Key: key,
    ContentType: input.contentType,
    ContentLength: input.fileSize,
    ACL: "public-read",
  });

  // Cast: a duplicate @aws-sdk/client-s3 in the dep tree yields two incompatible
  // S3Client types; runtime is the same instance.
  const uploadUrl = await getSignedUrl(s3Config as any, command, {
    expiresIn: PRESIGN_EXPIRY_SECONDS,
  });

  const fileUrl = publicUrlFor(key);

  return {
    uploadUrl,
    fileUrl,
    key,
    expiresIn: PRESIGN_EXPIRY_SECONDS,
    requiredHeaders: {
      "Content-Type": input.contentType,
      "x-amz-acl": "public-read",
    },
  };
};
