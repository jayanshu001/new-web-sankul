// src/config/upload.ts
import fs from "fs";
import path from "path";
import multer from "multer";
import type { Request } from "express";

// Ensure uploads directory exists
const uploadDir = path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure Storage for Images and Videos
const storage = multer.diskStorage({
  destination: (_req: Request, _file: Express.Multer.File, cb) => {
    cb(null, uploadDir); // Absolute path is safer
  },
  filename: (_req: Request, file: Express.Multer.File, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  },
});

// Multer upload instance
const upload = multer({
  storage,
  // Optional extras:
  // limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  // fileFilter: (_req, file, cb) => {
  //   const allowed = /^(image|video)\//.test(file.mimetype);
  //   cb(allowed ? null : new Error("Only image/video files are allowed"), allowed);
  // },
});

export default upload;
