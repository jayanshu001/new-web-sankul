import { S3Client, DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import multer from "multer";
import multerS3 from "multer-s3";
import path from "path";
import { UPLOAD_FOLDERS } from "../config/uploadFolders";
import { watermarkPdf } from "../utils/pdfWatermark";

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

/**
 * Public URL for an object key: https://<bucket>.<region>.digitaloceanspaces.com/<key>.
 * The one place this URL is built — presign, the PDF scheduler and every multer
 * storage below go through it.
 */
export const publicUrlFor = (key: string): string => {
  const endpoint = (
    process.env.DO_ENDPOINT || "https://blr1.digitaloceanspaces.com"
  ).replace(/\/+$/, "");
  const { protocol, host } = new URL(endpoint);
  return `${protocol}//${DO_BUCKET}.${host}/${key}`;
};

/**
 * multer-s3 copies `file.location` from @aws-sdk/lib-storage's `Location`, which
 * for a custom endpoint comes back path-style and scheme-less
 * ("blr1.digitaloceanspaces.com/<bucket>/<key>"). Controllers persist
 * `file.location` verbatim, so rewrite it here to the canonical public URL.
 */
const withPublicUrl = <T extends multer.StorageEngine>(storage: T): T => {
  const handle = storage._handleFile.bind(storage);
  storage._handleFile = (req, file, cb) =>
    handle(req, file, (err, info: any) =>
      cb(err, info?.key ? { ...info, location: publicUrlFor(info.key) } : info)
    );
  return storage;
};

/**
 * Route-level folder pick for the multer uploaders below. Mount it right before
 * the multer middleware: `uploadTo(UPLOAD_FOLDERS.package), uploadS3.single("image")`,
 * or per field for multi-file forms: `uploadTo({ image: …, thumbnail: … })`.
 * All paths live in `config/uploadFolders.ts`.
 */
type FolderPick = string | Record<string, string>;

export const uploadTo = (folder: FolderPick) => (req: any, _res: any, next: () => void) => {
  req.uploadFolder = folder;
  next();
};

const folderFor = (req: any, fieldname: string): string => {
  const pick: FolderPick | undefined = req?.uploadFolder;
  if (typeof pick === "string") return pick;
  // own-key lookup only — a field named e.g. "constructor" must not hit the prototype
  return (pick && Object.prototype.hasOwnProperty.call(pick, fieldname) && pick[fieldname]) || UPLOAD_FOLDERS.default;
};

// Bare filename only (the old app keeps just the last path segment). The random
// suffix keeps multi-file fields (e.g. offline center `images`) from colliding
// in the same millisecond.
const uniqueName = (file: Express.Multer.File) =>
  `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).toLowerCase()}`;

/**
 * Route-level opt-in: PDFs in this request get the websankul.com watermark
 * (utils/pdfWatermark.ts) before they reach Spaces. Mount next to `uploadTo`:
 * `uploadTo(UPLOAD_FOLDERS.jobsPapers), watermarkPdfs, uploadS3Mixed.array(…)`.
 * Only govt-jobs routes use it — paid content (ebooks, materials) stays clean.
 */
export const watermarkPdfs = (req: any, _res: any, next: () => void) => {
  req.watermarkPdfs = true;
  next();
};

const isPdfFile = (file: Express.Multer.File) =>
  file.mimetype === "application/pdf" || path.extname(file.originalname).toLowerCase() === ".pdf";

/**
 * Wraps a multer-s3 storage so that, on `watermarkPdfs` routes, PDFs are
 * buffered, stamped and then PUT to the same bucket/key layout. Anything else
 * (images, CSVs, non-opted-in routes) streams through the wrapped storage
 * untouched. A PDF that can't be stamped (encrypted/corrupt) uploads as-is.
 */
const withPdfWatermark = <T extends multer.StorageEngine>(storage: T): T => {
  const handle = storage._handleFile.bind(storage);
  storage._handleFile = (req: any, file, cb) => {
    if (!req?.watermarkPdfs || !isPdfFile(file)) return handle(req, file, cb);

    const chunks: Buffer[] = [];
    let truncated = false;
    file.stream.on("limit", () => {
      truncated = true;
    });
    file.stream.on("data", (chunk: Buffer) => {
      if (!truncated) chunks.push(chunk);
    });
    file.stream.on("error", (err) => cb(err));
    file.stream.on("end", async () => {
      // multer already rejects the request with LIMIT_FILE_SIZE — don't upload a partial file.
      if (truncated) return cb(null, {});
      try {
        const original = Buffer.concat(chunks);
        chunks.length = 0;
        const stamped = await watermarkPdf(original);
        const body = stamped ? Buffer.from(stamped) : original;
        const key = `${folderFor(req, file.fieldname)}/${uniqueName(file)}`;
        await s3Config.send(
          new PutObjectCommand({
            Bucket: DO_BUCKET,
            Key: key,
            Body: body,
            ContentType: "application/pdf",
            ACL: "public-read",
          })
        );
        // Same shape as multer-s3's info, so `_removeFile`, `enforceMixedSizeLimits`
        // and the controllers (`file.location`) work unchanged.
        cb(null, {
          bucket: DO_BUCKET,
          key,
          acl: "public-read",
          contentType: "application/pdf",
          size: body.length,
          location: publicUrlFor(key),
        } as any);
      } catch (err) {
        cb(err as Error);
      }
    });
  };
  return storage;
};

const s3Storage = withPdfWatermark(withPublicUrl(multerS3({
  s3: s3Config,
  bucket: process.env.DO_BUCKET || "websankul-staging",
  acl: "public-read", // Makes file publicly accessible via CDN URL
  contentType: multerS3.AUTO_CONTENT_TYPE,
  key: function (req, file, cb) {
    // e.g. uploads/package/1678123412-123456789.jpg — folder from `uploadTo(...)`
    cb(null, `${folderFor(req, file.fieldname)}/${uniqueName(file)}`);
  },
})));

/**
 * multer 2.x decodes multipart field/file names as **latin1** by default
 * (node_modules/multer/index.js:22). A Gujarati or Hindi file name therefore
 * arrives on `file.originalname` already mojibake — before any DB write — and
 * the garbled bytes then fail the insert. Every `multer({...})` instance below
 * must spread this so `originalname` is real UTF-8.
 */
const MULTER_UTF8: Pick<multer.Options, "defParamCharset"> = {
  defParamCharset: "utf8",
};

const IMAGE_FIELDS = new Set(["image", "thumbnail", "profilePicture", "featuredImage", "ogImage", "logo", "previewImage"]);
const PDF_FIELDS = new Set(["demoUrl", "bookUrl", "file", "solutionPdfUrl"]);
const IMAGE_TYPES = /jpeg|jpg|png|webp/;
const PDF_TYPES = /pdf/;
const AUDIO_TYPES = /mp3|mpeg|m4a|aac|wav|webm|ogg|opus/;
const DOCUMENT_EXT = /\.(pdf|csv|xlsx|xls|md|txt|doc|docx|ppt|pptx|zip)$/i;
const DOCUMENT_MIME = /^(application\/pdf|text\/csv|text\/markdown|text\/plain|application\/octet-stream|application\/vnd\.ms-excel|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|application\/vnd\.ms-powerpoint|application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation|application\/(x-)?zip|application\/x-zip-compressed)$/i;

export const uploadS3 = multer({
  ...MULTER_UTF8,
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
// allowed (PDFs at 300 MB); images get rejected earlier inside the filter.
const IMAGE_MAX_BYTES = 3 * 1024 * 1024;
const PDF_MAX_BYTES = 300 * 1024 * 1024;

export const uploadS3Mixed = multer({
  ...MULTER_UTF8,
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
  // `.fields()` gives { field: File[] }, `.array()` gives a flat File[] — accept both.
  const files = req.files as Record<string, Express.MulterS3.File[]> | Express.MulterS3.File[] | undefined;
  if (!files) return next();
  const all = Array.isArray(files) ? files : Object.values(files).flat();
  const oversized = all.filter(
    (f) => f.size > (IMAGE_FIELDS.has(f.fieldname) ? IMAGE_MAX_BYTES : PDF_MAX_BYTES)
  );
  if (oversized.length === 0) return next();
  await Promise.all(
    oversized.map((f) =>
      deleteFromS3FileUrl((f as any).location).catch(() => {})
    )
  );
  const first = oversized[0];
  const cap = IMAGE_FIELDS.has(first.fieldname) ? "3 MB" : "300 MB";
  next(new Error(`${first.fieldname} exceeds the ${cap} limit.`));
};

// Reference documents attached inline in an editor (e.g. job content
// download links: admit card/result/answer-key/syllabus PDFs, result CSVs,
// syllabus sheets). Single file under the `file` field; folder from `uploadTo(...)`.
const documentStorage = withPdfWatermark(withPublicUrl(multerS3({
  s3: s3Config,
  bucket: process.env.DO_BUCKET || "websankul-staging",
  acl: "public-read",
  contentType: multerS3.AUTO_CONTENT_TYPE,
  key: function (req, file, cb) {
    cb(null, `${folderFor(req, file.fieldname)}/${uniqueName(file)}`);
  },
})));

export const uploadS3Document = multer({
  ...MULTER_UTF8,
  storage: documentStorage,
  limits: {
    fileSize: PDF_MAX_BYTES, // 300 MB — same ceiling as job paper PDFs
  },
  fileFilter: (_req, file, cb) => {
    if (!process.env.DO_ACCESS_KEY_ID || !process.env.DO_SECRET_ACCESS_KEY) {
      return cb(new Error("File uploads are disabled: DigitalOcean Spaces credentials are not configured."));
    }
    const ext = path.extname(file.originalname).toLowerCase();
    if (DOCUMENT_EXT.test(ext) && DOCUMENT_MIME.test(file.mimetype)) return cb(null, true);
    cb(new Error("Invalid file type. Only PDF, Word, Excel, PowerPoint, CSV, MD, TXT, and ZIP are allowed."));
  },
});

// Customer-recorded audio notes attached to a lecture moment. Single file
// per upload under the `audio` fieldname; stored under a customer-scoped
// prefix so the bucket browser stays readable.
const audioStorage = withPublicUrl(multerS3({
  s3: s3Config,
  bucket: process.env.DO_BUCKET || "websankul-staging",
  acl: "public-read",
  contentType: multerS3.AUTO_CONTENT_TYPE,
  key: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase() || ".webm";
    const userId = (req as any)?.user?.id || "anon";
    const filename = `${UPLOAD_FOLDERS.audioNotes}/${userId}/${Date.now()}-${Math.round(
      Math.random() * 1e9
    )}${ext}`;
    cb(null, filename);
  },
}));

export const uploadS3Audio = multer({
  ...MULTER_UTF8,
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
const questionImageStorage = withPublicUrl(multerS3({
  s3: s3Config,
  bucket: process.env.DO_BUCKET || "websankul-staging",
  acl: "public-read",
  contentType: multerS3.AUTO_CONTENT_TYPE,
  key: function (_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const filename = `${UPLOAD_FOLDERS.questions}/${Date.now()}-${Math.round(Math.random() * 1e9)}-${file.fieldname}${ext}`;
    cb(null, filename);
  },
}));

export const uploadQuestionImages = multer({
  ...MULTER_UTF8,
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

const RANK_PDF_MAX_BYTES = 25 * 1024 * 1024;
const PDF_MAGIC = "%PDF-";
/** Readers accept the header anywhere in the first 1 KB, so a valid sheet may have bytes before it. */
const PDF_HEADER_WINDOW = 1024;

/** Read by the error handler as a 4xx, so a bad file is the student's error, not a 500 alert. */
const uploadError = (statusCode: number, message: string, error: string) =>
  Object.assign(new Error(message), { statusCode, errorObject: { error } });

const NOT_A_PDF = () => uploadError(415, "Only PDF response sheets are accepted.", "file_not_pdf");

const rankPdfMulter = multer({
  ...MULTER_UTF8,
  storage: multer.memoryStorage(),
  // One file; text fields keep multer's 1 MB size default (a pasted answer key can be long).
  limits: { fileSize: RANK_PDF_MAX_BYTES, files: 1, fields: 50 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf") return cb(null, true);
    cb(NOT_A_PDF());
  },
});

/**
 * The optional `file` field of a rank-predictor upload, kept in memory. The declared
 * type is the client's word, so the bytes must also start with the PDF header.
 */
export const uploadRankPdfToMemory = {
  single: (field: string): import("express").RequestHandler => (req, res, next) =>
    rankPdfMulter.single(field)(req, res, (err?: unknown) => {
      if (err instanceof multer.MulterError) {
        return next(
          err.code === "LIMIT_FILE_SIZE"
            ? uploadError(413, "That PDF is larger than 25 MB.", "file_too_large")
            : uploadError(400, "Send one PDF in the `file` field.", "invalid_upload")
        );
      }
      if (err) return next(err);
      if (req.file && !req.file.buffer.subarray(0, PDF_HEADER_WINDOW).toString("latin1").includes(PDF_MAGIC)) {
        return next(NOT_A_PDF());
      }
      next();
    }),
};
