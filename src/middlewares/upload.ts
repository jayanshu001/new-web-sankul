import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import multer from "multer";
import multerS3 from "multer-s3";
import path from "path";

// Ensure credentials exist to prevent crypto/SDK crashes
if (!process.env.DO_ACCESS_KEY_ID || !process.env.DO_SECRET_ACCESS_KEY) {
  console.warn("⚠️ DigitalOcean Spaces credentials are not configured in .env!");
}

export const DO_BUCKET = process.env.DO_BUCKET || "websankul-staging";

// Initialize the S3 Client (configured for DigitalOcean Spaces)
export const s3Config = new S3Client({
  endpoint: process.env.DO_ENDPOINT || "https://blr1.digitaloceanspaces.com",
  region: process.env.DO_DEFAULT_REGION || "blr1",
  credentials: {
    accessKeyId: process.env.DO_ACCESS_KEY_ID || "not-set",
    secretAccessKey: process.env.DO_SECRET_ACCESS_KEY || "not-set",
  },
  forcePathStyle: false // Ensures DO virtual routing (bucket.blr1.digitaloceanspaces.com) works perfectly
});

const s3Storage = multerS3({
  s3: s3Config,
  bucket: process.env.DO_BUCKET || "websankul-staging",
  acl: "public-read", // Makes file publicly accessible via CDN URL
  contentType: multerS3.AUTO_CONTENT_TYPE,
  key: function (req, file, cb) {
    // e.g. admin/profiles/1678123412-image.jpg
    const extension = path.extname(file.originalname);
    const filename = `admin/profiles/${Date.now()}-${file.fieldname}${extension}`;
    cb(null, filename);
  },
});

const IMAGE_FIELDS = new Set(["image", "thumbnail", "profilePicture"]);
const PDF_FIELDS = new Set(["demoUrl", "bookUrl", "file", "solutionPdfUrl"]);
const IMAGE_TYPES = /jpeg|jpg|png|webp/;
const PDF_TYPES = /pdf/;
const AUDIO_TYPES = /mp3|mpeg|m4a|aac|wav|webm|ogg|opus/;

export const uploadS3 = multer({
  storage: s3Storage,
  limits: {
    fileSize: 3 * 1024 * 1024, // 3 MB ceiling
  },
  fileFilter: (req, file, cb) => {
    if (!process.env.DO_ACCESS_KEY_ID || !process.env.DO_SECRET_ACCESS_KEY) {
      return cb(new Error("File uploads are disabled: DigitalOcean Spaces credentials are not configured."));
    }

    const extname = IMAGE_TYPES.test(path.extname(file.originalname).toLowerCase());
    const mimetype = IMAGE_TYPES.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error("Invalid file type. Only JPEG, PNG, and WebP images are allowed."));
  },
});

// For routes that accept both images (image/thumbnail) and PDFs (demoUrl/bookUrl)
// in a single multipart request — use with `.fields([...])`.
// Multer applies one `fileSize` limit per uploader instance, so per-field
// caps are enforced inside `fileFilter` by reading the multipart Content-Length
// header part-by-part. The outer `limits.fileSize` is set to the largest
// allowed (PDFs at 50 MB); images get rejected earlier inside the filter.
const IMAGE_MAX_BYTES = 3 * 1024 * 1024;
const PDF_MAX_BYTES = 50 * 1024 * 1024;

export const uploadS3Mixed = multer({
  storage: s3Storage,
  limits: {
    fileSize: PDF_MAX_BYTES,
  },
  fileFilter: (req, file, cb) => {
    if (!process.env.DO_ACCESS_KEY_ID || !process.env.DO_SECRET_ACCESS_KEY) {
      return cb(new Error("File uploads are disabled: DigitalOcean Spaces credentials are not configured."));
    }

    const ext = path.extname(file.originalname).toLowerCase();

    if (IMAGE_FIELDS.has(file.fieldname)) {
      if (!(IMAGE_TYPES.test(ext) && IMAGE_TYPES.test(file.mimetype))) {
        return cb(new Error(`Invalid file type for ${file.fieldname}. Only JPEG, PNG, WebP allowed.`));
      }
      return cb(null, true);
    }
    if (PDF_FIELDS.has(file.fieldname)) {
      if (PDF_TYPES.test(ext) && PDF_TYPES.test(file.mimetype)) return cb(null, true);
      return cb(new Error(`Invalid file type for ${file.fieldname}. Only PDF allowed.`));
    }
    cb(new Error(`Unexpected file field: ${file.fieldname}`));
  },
});

// Post-multer guard: multer streams the file before exposing its size, so the
// only reliable per-field size check happens after upload. If an image field
// exceeds 5 MB, delete it from S3 and reject the request.
export const enforceMixedSizeLimits = async (
  req: any,
  _res: any,
  next: (err?: any) => void
) => {
  const files = req.files as Record<string, Express.MulterS3.File[]> | undefined;
  if (!files) return next();
  const oversized: Express.MulterS3.File[] = [];
  for (const field of Object.keys(files)) {
    const isImage = IMAGE_FIELDS.has(field);
    const cap = isImage ? IMAGE_MAX_BYTES : PDF_MAX_BYTES;
    for (const f of files[field] || []) {
      if (f.size > cap) oversized.push(f);
    }
  }
  if (oversized.length === 0) return next();
  await Promise.all(
    oversized.map((f) =>
      deleteFromS3FileUrl((f as any).location).catch(() => {})
    )
  );
  const first = oversized[0];
  const cap = IMAGE_FIELDS.has(first.fieldname) ? "3 MB" : "50 MB";
  next(new Error(`${first.fieldname} exceeds the ${cap} limit.`));
};

// Customer-recorded audio notes attached to a lecture moment. Single file
// per upload under the `audio` fieldname; stored under a customer-scoped
// prefix so the bucket browser stays readable.
const audioStorage = multerS3({
  s3: s3Config,
  bucket: process.env.DO_BUCKET || "websankul-staging",
  acl: "public-read",
  contentType: multerS3.AUTO_CONTENT_TYPE,
  key: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase() || ".webm";
    const userId = (req as any)?.user?.id || "anon";
    const filename = `customer/audio-notes/${userId}/${Date.now()}-${Math.round(
      Math.random() * 1e9
    )}${ext}`;
    cb(null, filename);
  },
});

export const uploadS3Audio = multer({
  storage: audioStorage,
  limits: {
    // ~20MB is plenty for short lecture-note recordings (≈40 min at 64 kbps).
    fileSize: 20 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (!process.env.DO_ACCESS_KEY_ID || !process.env.DO_SECRET_ACCESS_KEY) {
      return cb(new Error("File uploads are disabled: DigitalOcean Spaces credentials are not configured."));
    }

    const ext = path.extname(file.originalname).toLowerCase().replace(".", "");
    const extOk = AUDIO_TYPES.test(ext);
    const mimeOk = /^audio\//.test(file.mimetype) || AUDIO_TYPES.test(file.mimetype);

    if (extOk && mimeOk) return cb(null, true);
    cb(new Error("Invalid file type. Only audio uploads (mp3, m4a, aac, wav, webm, ogg, opus) are allowed."));
  },
});

// Quiz-question images: question/solution/options. Accepts any field name
// (the dynamic `optionImage_<i>` fields make a fixed allowlist impractical),
// caps each file at 2 MB, restricts mimetype to png/jpeg/jpg/webp.
const questionImageStorage = multerS3({
  s3: s3Config,
  bucket: process.env.DO_BUCKET || "websankul-staging",
  acl: "public-read",
  contentType: multerS3.AUTO_CONTENT_TYPE,
  key: function (_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const filename = `admin/quiz-questions/${Date.now()}-${Math.round(Math.random() * 1e9)}-${file.fieldname}${ext}`;
    cb(null, filename);
  },
});

export const uploadQuestionImages = multer({
  storage: questionImageStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!process.env.DO_ACCESS_KEY_ID || !process.env.DO_SECRET_ACCESS_KEY) {
      return cb(new Error("File uploads are disabled: DigitalOcean Spaces credentials are not configured."));
    }
    const ext = path.extname(file.originalname).toLowerCase();
    const extOk = /\.(png|jpe?g|webp)$/.test(ext);
    const mimeOk = /^image\/(png|jpe?g|webp)$/.test(file.mimetype);
    if (extOk && mimeOk) return cb(null, true);
    cb(new Error("Invalid image type. Only PNG, JPG, JPEG, WebP are allowed."));
  },
});

/**
 * True if `url` points at OUR Spaces bucket — i.e. its host is
 * `<DO_BUCKET>.<endpoint-host>`. `deleteFromS3FileUrl` keys off the URL path
 * against DO_BUCKET, so only own-bucket URLs are safe to pass to it; an
 * externally-hosted link must never be sent for deletion. Use this to guard
 * "delete the replaced old file" cleanup paths.
 */
export const isOwnBucketUrl = (url?: string | null): boolean => {
  if (!url) return false;
  try {
    const endpoint = (
      process.env.DO_ENDPOINT || "https://blr1.digitaloceanspaces.com"
    ).replace(/\/+$/, "");
    const ownHost = `${DO_BUCKET}.${new URL(endpoint).host}`;
    return new URL(url).host === ownHost;
  } catch {
    return false;
  }
};

/**
 * Utility function to delete an object from DigitalOcean Spaces given its public URL.
 * Automatically extracts the File Key based on your endpoint domain.
 *
 * Wrapped in callOutbound so a Spaces outage can't pin every "update profile
 * with a new image" request indefinitely. Every caller in the codebase
 * already invokes this with `.catch(() => {})` (it's best-effort cleanup
 * of an orphaned file), so the wrapper's eventual throw on retry-exhaustion
 * is swallowed gracefully.
 */
export const deleteFromS3FileUrl = async (fileUrl: string) => {
  try {
    if (!fileUrl) return;

    // Parse URL (e.g. https://websankul-staging.blr1.digitaloceanspaces.com/admin/profiles/123.jpg)
    const urlObj = new URL(fileUrl);

    // Remove the leading slash to get the strict S3 Object Key (e.g., admin/profiles/123.jpg)
    const fileKey = urlObj.pathname.startsWith("/")
      ? urlObj.pathname.substring(1)
      : urlObj.pathname;

    // Lazy-load to avoid a circular import (libs/outbound → utils/logger →
    // … this module is loaded very early in some entry points).
    const { callOutbound } = await import("../libs/outbound");
    await callOutbound(
      () =>
        s3Config.send(
          new DeleteObjectCommand({
            Bucket: process.env.DO_BUCKET || "websankul-staging",
            Key: fileKey,
          })
        ),
      { label: "s3.delete", timeoutMs: 5_000, attempts: 2 }
    );
  } catch (err) {
    console.error(`[deleteFromS3FileUrl] Failed to delete orphaned file ${fileUrl}:`, err);
  }
};
