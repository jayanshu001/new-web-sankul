// Export storage: private Spaces upload, signed download and delete for report exports.
// Report exports may contain customer PII, so unlike the rest of the (public-read)
// bucket they are written PRIVATE and served via short-lived signed GET URLs.

import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Upload } from "@aws-sdk/lib-storage";
import { PassThrough } from "node:stream";
import { s3Config, DO_BUCKET } from "../middlewares/upload";

// Signed fresh on every poll, so this only bounds a single click.
export const EXPORT_URL_TTL_SECONDS = Number(process.env.EXPORT_SIGNED_URL_TTL_SECONDS) || 15 * 60;

// A duplicate @aws-sdk/client-s3 in the dep tree yields two incompatible S3Client types.
const client = s3Config as any;

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
      ContentDisposition: `attachment; filename="${fileName.replace(/"/g, "")}"`,
    })
  );
};

/**
 * Streaming multipart PRIVATE upload: write the file into `body`; `done` resolves
 * once Spaces has the whole object. Large exports never sit fully in RAM and no
 * total size is needed up front.
 */
export const createExportUpload = (
  key: string,
  contentType: string,
  fileName: string
): { body: PassThrough; done: Promise<void> } => {
  const body = new PassThrough();
  const upload = new Upload({
    client,
    params: {
      Bucket: DO_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      ACL: "private",
      ContentDisposition: `attachment; filename="${fileName.replace(/"/g, "")}"`,
    },
    // Bounds peak memory to ~20 MB per job.
    partSize: 5 * 1024 * 1024,
    queueSize: 4,
  });
  const done = upload.done().then(() => undefined);
  return { body, done };
};

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

/** Retention GC; best-effort, never throws. */
export const deleteExportObject = async (key: string): Promise<void> => {
  try {
    await client.send(new DeleteObjectCommand({ Bucket: DO_BUCKET, Key: key }));
  } catch {
    /* object may already be gone; GC is best-effort */
  }
};
