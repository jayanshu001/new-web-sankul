// src/utils/exportStorage.ts
//
// Spaces storage for async report exports. Unlike the rest of the bucket (which is
// public-read CDN content), generated exports are written PRIVATE and handed to the
// admin via a short-lived signed GET URL — the file may contain customer PII, so it
// must not be publicly guessable. Mirrors the S3 client + bucket used everywhere else
// (src/middlewares/upload.ts); adds the GET-presign the codebase didn't have yet.

import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3Config, DO_BUCKET } from "../middlewares/upload";

// How long a signed download URL stays valid. Signed fresh on every poll, so this
// only bounds a single click's validity — short is fine.
export const EXPORT_URL_TTL_SECONDS = Number(process.env.EXPORT_SIGNED_URL_TTL_SECONDS) || 15 * 60;

// s3Config is an S3Client; a duplicate @aws-sdk/client-s3 in the dep tree surfaces two
// incompatible S3Client type declarations, so cast at the call site (runtime unaffected).
const client = s3Config as any;

/** PUT a generated export (CSV/XLSX buffer) to Spaces as a PRIVATE object. */
export const uploadExportObject = async (
  key: string,
  body: Buffer,
  contentType: string,
  fileName: string
): Promise<void> => {
  await client.send(
    new PutObjectCommand({
      Bucket: DO_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentLength: body.length,
      ACL: "private",
      // so the browser saves with a friendly name even via the raw signed URL
      ContentDisposition: `attachment; filename="${fileName.replace(/"/g, "")}"`,
    })
  );
};

/** Short-lived signed GET URL for a private export object. */
export const getSignedDownloadUrl = async (
  key: string,
  fileName: string,
  expiresIn: number = EXPORT_URL_TTL_SECONDS
): Promise<string> =>
  getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: DO_BUCKET,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${fileName.replace(/"/g, "")}"`,
    }),
    { expiresIn }
  );

/** Delete an export object (retention GC). Best-effort; never throws to the caller. */
export const deleteExportObject = async (key: string): Promise<void> => {
  try {
    await client.send(new DeleteObjectCommand({ Bucket: DO_BUCKET, Key: key }));
  } catch {
    /* object may already be gone; GC is best-effort */
  }
};
