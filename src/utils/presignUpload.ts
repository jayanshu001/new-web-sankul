// src/utils/presignUpload.ts
//
// Presigned direct-to-Spaces uploads for large files (e.g. eBook book PDFs up
// to 500 MB). The browser PUTs the file straight to DigitalOcean Spaces using
// a short-lived signed URL, so the bytes never pass through this server — no
// request held open, no Express/proxy timeout, no server bandwidth. The server
// only signs the URL and later records the resulting public file URL.
//
// Flow:
//   1. Client → POST /admin/uploads/presign { fileName, contentType, kind }
//      → server returns { uploadUrl, fileUrl, key, expiresIn }
//   2. Client → PUT <uploadUrl> with the raw file bytes + the SAME Content-Type
//   3. Client → create/update ebook with bookUrl = <fileUrl>
//
// NOTE: For step 2 to work from a browser, the Spaces bucket must have a CORS
// rule allowing PUT from the admin origin (see docs/large-pdf-upload.md).

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import path from "path";
import { s3Config, DO_BUCKET } from "../middlewares/upload";

// How long the signed PUT URL stays valid. Long enough for a 500 MB upload on
// a slow connection (~3 Mbps ≈ 22 min), short enough to limit URL leakage.
const PRESIGN_EXPIRY_SECONDS = 30 * 60; // 30 minutes

// Hard ceiling we advertise/enforce for presigned uploads. Spaces itself does
// not enforce this for a simple PUT, so we also pin Content-Length at sign time
// (see below) which makes the signed URL only usable for a file of that exact
// size — the real guardrail.
export const PRESIGN_MAX_BYTES = 500 * 1024 * 1024; // 500 MB

// Allowed upload "kinds" → (key prefix, allowed extensions, allowed mimetypes).
// Keeps presign from being an open relay to write arbitrary keys/types.
const KINDS = {
  ebookPdf: {
    prefix: "admin/ebooks",
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
  fileSize: number; // bytes — required so we can pin Content-Length
}

export interface PresignResult {
  uploadUrl: string; // PUT here with the raw bytes
  fileUrl: string; // public URL to store as bookUrl after upload completes
  key: string;
  expiresIn: number;
  requiredHeaders: Record<string, string>; // headers the client MUST send on the PUT
}

const sanitizeName = (name: string) =>
  path
    .basename(name)
    .replace(/[^\w.\-]+/g, "_")
    .slice(-120); // keep the tail (extension) if the name is very long

/**
 * Build a presigned PUT URL for a direct-to-Spaces upload. Validates the kind,
 * extension, mimetype and size, then signs a URL pinned to the exact
 * Content-Type and Content-Length the client declared — so the URL can only be
 * used to upload that specific file shape.
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

  // Date.now()-based key keeps uploads unique; Math.random suffix avoids
  // collisions when two admins upload same-named files in the same ms.
  const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const key = `${cfg.prefix}/${unique}-${safeName}`;

  const command = new PutObjectCommand({
    Bucket: DO_BUCKET,
    Key: key,
    ContentType: input.contentType,
    ContentLength: input.fileSize, // pins the URL to this exact size
    ACL: "public-read", // match the rest of the bucket's public-CDN model
  });

  const uploadUrl = await getSignedUrl(s3Config, command, {
    expiresIn: PRESIGN_EXPIRY_SECONDS,
  });

  const endpoint = (
    process.env.DO_ENDPOINT || "https://blr1.digitaloceanspaces.com"
  ).replace(/\/+$/, "");
  // Public CDN-style URL: https://<bucket>.<region>.digitaloceanspaces.com/<key>
  const { protocol, host } = new URL(endpoint);
  const fileUrl = `${protocol}//${DO_BUCKET}.${host}/${key}`;

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
