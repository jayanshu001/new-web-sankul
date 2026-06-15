import mongoose, { Schema, Document } from "mongoose";
import { EBookLanguage } from "../enums";

// Lifecycle of a Book/Demo PDF on an ebook, persisted so the admin list can show
// uploading/processing/failed/done that survives a refresh and is visible to any
// admin (the upload pipeline's per-session socket batchId can't be queried).
// "none" = no PDF in that slot; "completed" = PDF attached & ready.
export type EbookUploadStatus =
  | "none"
  | "queued"
  | "processing"
  | "completed"
  | "failed";

export interface IEbook extends Document {
  name: string;
  examCountdownCategoryId?: mongoose.Types.ObjectId | null;
  // Multi-select exam-countdown links. `examCountdownCategoryIds` is the
  // many-to-many successor to the legacy single `examCountdownCategoryId`
  // (which stays for back-compat); `examCountdownIds` links to specific exam
  // events. Both default to [] — an empty array means "cleared".
  examCountdownCategoryIds: mongoose.Types.ObjectId[];
  examCountdownIds: mongoose.Types.ObjectId[];
  description: string;
  author: string;
  publisher: string;
  language: EBookLanguage;
  order: number;
  image?: string;
  thumbnail?: string;
  demoUrl?: string;
  bookUrl?: string;
  demoFileName?: string;
  bookFileName?: string;
  // PDF-upload status per slot — written by the upload pipeline, read by the
  // admin ebooks list/detail. See EbookUploadStatus.
  bookUploadStatus: EbookUploadStatus;
  bookUploadProgress: number;
  demoUploadStatus: EbookUploadStatus;
  demoUploadProgress: number;
  link: string;
  termsAndConditions?: string;
  isTrending: boolean;
  isPaid: boolean;
  status: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ebookSchema: Schema = new Schema(
  {
    name: { type: String, required: true },
    examCountdownCategoryId: {
      type: Schema.Types.ObjectId,
      ref: "ExamCountdownCategory",
      default: null,
    },
    examCountdownCategoryIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "ExamCountdownCategory" }],
      default: [],
    },
    examCountdownIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "ExamCountdown" }],
      default: [],
    },
    description: { type: String, required: true },
    author: { type: String, required: true },
    publisher: { type: String, required: true },
    language: { type: String, enum: Object.values(EBookLanguage), required: true },
    order: { type: Number, default: 0 },
    image: { type: String, default: null },
    thumbnail: { type: String, default: null },
    demoUrl: { type: String, default: null },
    bookUrl: { type: String, default: null },
    demoFileName: { type: String, default: null },
    bookFileName: { type: String, default: null },
    bookUploadStatus: {
      type: String,
      enum: ["none", "queued", "processing", "completed", "failed"],
      default: "none",
    },
    bookUploadProgress: { type: Number, default: 0, min: 0, max: 100 },
    demoUploadStatus: {
      type: String,
      enum: ["none", "queued", "processing", "completed", "failed"],
      default: "none",
    },
    demoUploadProgress: { type: Number, default: 0, min: 0, max: 100 },
    link: { type: String, required: true },
    termsAndConditions: { type: String, default: null },
    isTrending: { type: Boolean, default: false },
    // Paid by default — matches frontend default and the Course.isPaid convention.
    isPaid: { type: Boolean, default: true },
    status: { type: Boolean, default: true },
  },
  { timestamps: true }
);

ebookSchema.index({ status: 1, order: 1 });
ebookSchema.index({ examCountdownCategoryId: 1, status: 1, order: 1 });
ebookSchema.index({ examCountdownCategoryIds: 1, status: 1, order: 1 });
ebookSchema.index({ examCountdownIds: 1, status: 1, order: 1 });
ebookSchema.index({ status: 1, isTrending: 1, order: 1 });
ebookSchema.index(
  { author: "text", name: "text" },
  { default_language: "none", language_override: "_none" }
);

export const Ebook = mongoose.model<IEbook>("Ebook", ebookSchema, "ws_ebooks");
