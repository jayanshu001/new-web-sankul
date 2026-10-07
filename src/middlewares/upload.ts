// File uploads: DigitalOcean Spaces client and multer uploaders (images, PDFs, docs, audio).
import { S3Client, DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import multer from "multer";
import multerS3 from "multer-s3";
import path from "path";
import { UPLOAD_FOLDERS } from "../config/uploadFolders";
import { watermarkPdf } from "../utils/pdfWatermark";

if (!process.env.DO_ACCESS_KEY_ID || !process.env.DO_SECRET_ACCESS_KEY) {
  console.warn("⚠️ DigitalOcean Spaces credentials are not configured in .env!");
}

export const DO_BUCKET = process.env.DO_BUCKET || "websankul-staging";

export const s3Config = new S3Client({
  endpoint: process.env.DO_ENDPOINT || "https://blr1.digitaloceanspaces.com",
  region: process.env.DO_DEFAULT_REGION || "blr1",
  credentials: {
    accessKeyId: process.env.DO_ACCESS_KEY_ID || "not-set",
    secretAccessKey: process.env.DO_SECRET_ACCESS_KEY || "not-set",
  },
  forcePathStyle: false // virtual-host style: bucket.blr1.digitaloceanspaces.com
});

/** Public URL for an object key. The one place it is built (presign, PDF scheduler, multer storages). */
export const publicUrlFor = (key: string): string => {
  const endpoint = (
    process.env.DO_ENDPOINT || "https://blr1.digitaloceanspaces.com"
  ).replace(/\/+$/, "");
  const { protocol, host } = new URL(endpoint);
  return `${protocol}//${DO_BUCKET}.${host}/${key}`;
};

/**
 * multer-s3's `file.location` comes back path-style and scheme-less for a custom
 * endpoint; controllers persist it verbatim, so rewrite it to the canonical public URL.
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
 * Picks the Spaces folder for the multer uploaders; mount right before them, e.g.
 * `uploadTo(UPLOAD_FOLDERS.package), uploadS3.single("image")` or per field
 * `uploadTo({ image: …, thumbnail: … })`. Paths live in `config/uploadFolders.ts`.
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

// The random suffix keeps multi-file fields from colliding in the same millisecond.
const uniqueName = (file: Express.Multer.File) =>
  `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).toLowerCase()}`;

/**
 * Opt-in: PDFs in this request get the websankul.com watermark before reaching Spaces.
 * Mount next to `uploadTo`. Only govt-jobs routes use it; paid content stays clean.
 */
export const watermarkPdfs = (req: any, _res: any, next: () => void) => {
  req.watermarkPdfs = true;
  next();
};

const isPdfFile = (file: Express.Multer.File) =>
  file.mimetype === "application/pdf" || path.extname(file.originalname).toLowerCase() === ".pdf";

/**
 * On `watermarkPdfs` routes, PDFs are buffered, stamped and PUT to the same key layout;
 * everything else streams through untouched. An unstampable PDF uploads as-is.
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
  acl: "public-read",
  contentType: multerS3.AUTO_CONTENT_TYPE,
  key: function (req, file, cb) {
    cb(null, `${folderFor(req, file.fieldname)}/${uniqueName(file)}`);
  },
})));

/**
 * multer 2.x decodes multipart names as latin1 by default, so Gujarati/Hindi file names
 * arrive as mojibake and fail the DB insert. Every `multer({...})` below must spread this.
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

// Single-image uploader: JPEG/PNG/WebP, 3 MB cap.
export const uploadS3 = multer({
  ...MULTER_UTF8,
  storage: s3Storage,
  limits: {
    fileSize: 3 * 1024 * 1024,
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

// Images + PDFs in one multipart request (use with `.fields([...])`). Multer has one
// `fileSize` limit per instance, so it is set to the largest (PDFs); image caps are
// enforced afterwards by `enforceMixedSizeLimits`.
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

// Multer streams the file before its size is known, so per-field limits are checked
// after upload: an oversized image is deleted from S3 and the request rejected.
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

// Reference documents attached inline in an editor (admit card/result PDFs, CSVs, sheets).
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
    fileSize: PDF_MAX_BYTES,
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

// Customer-recorded audio notes on a lecture moment, under a customer-scoped prefix.
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

// Quiz-question images. Any field name is accepted because `optionImage_<i>` fields are dynamic.
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
 * True if `url` is in our Spaces bucket. `deleteFromS3FileUrl` keys off the URL path
 * against DO_BUCKET, so guard replaced-file cleanup with this; external links must never be deleted.
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
 * Best-effort delete by public URL. Wrapped in callOutbound so a Spaces outage can't
 * hang requests; callers `.catch(() => {})` the eventual throw.
 */
export const deleteFromS3FileUrl = async (fileUrl: string) => {
  try {
    if (!fileUrl) return;

    const urlObj = new URL(fileUrl);

    const fileKey = urlObj.pathname.startsWith("/")
      ? urlObj.pathname.substring(1)
      : urlObj.pathname;

    // Lazy-loaded to avoid a circular import; this module loads very early.
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

// Rank-predictor PDF (answer key or response sheet) kept in memory for parsing, never sent to Spaces; 25 MB cap.
export const uploadRankPdfToMemory = multer({
  ...MULTER_UTF8,
  storage: multer.memoryStorage(),
  limits: { fileSize: RANK_PDF_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf") return cb(null, true);
    cb(new Error("Only PDF response sheets are accepted."));
  },
});
