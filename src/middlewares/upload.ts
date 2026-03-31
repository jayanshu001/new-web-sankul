import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import multer from "multer";
import multerS3 from "multer-s3";
import path from "path";

// Ensure credentials exist to prevent crypto/SDK crashes
if (!process.env.DO_ACCESS_KEY_ID || !process.env.DO_SECRET_ACCESS_KEY) {
  console.warn("⚠️ DigitalOcean Spaces credentials are not configured in .env!");
}

// Initialize the S3 Client (configured for DigitalOcean Spaces)
const s3Config = new S3Client({
  endpoint: process.env.DO_ENDPOINT || "https://blr1.digitaloceanspaces.com",
  region: process.env.DO_DEFAULT_REGION || "blr1",
  credentials: {
    accessKeyId: process.env.DO_ACCESS_KEY_ID || "not-set",
    secretAccessKey: process.env.DO_SECRET_ACCESS_KEY || "not-set",
  },
  forcePathStyle: false // Ensures DO virtual routing (bucket.blr1.digitaloceanspaces.com) works perfectly
});

export const uploadS3 = multer({
  storage: multerS3({
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
  }),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB ceiling
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true); // Allow
    }
    // Reject
    cb(new Error("Invalid file type. Only JPEG, PNG, and WebP images are allowed."));
  },
});

/**
 * Utility function to delete an object from DigitalOcean Spaces given its public URL.
 * Automatically extracts the File Key based on your endpoint domain.
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

    await s3Config.send(
      new DeleteObjectCommand({
        Bucket: process.env.DO_BUCKET || "websankul-staging",
        Key: fileKey,
      })
    );
  } catch (err) {
    console.error(`[deleteFromS3FileUrl] Failed to delete orphaned file ${fileUrl}:`, err);
  }
};
