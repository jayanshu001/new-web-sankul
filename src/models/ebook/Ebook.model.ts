import mongoose, { Schema, Document } from "mongoose";
import { EBookLanguage } from "../enums";

export interface IEbook extends Document {
  name: string;
  examCountdownCategoryId?: mongoose.Types.ObjectId | null;
  description: string;
  author: string;
  publisher: string;
  language: EBookLanguage;
  order: number;
  image?: string;
  thumbnail?: string;
  demoUrl?: string;
  bookUrl?: string;
  link: string;
  termsAndConditions?: string;
  isTrending: boolean;
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
    description: { type: String, required: true },
    author: { type: String, required: true },
    publisher: { type: String, required: true },
    language: { type: String, enum: Object.values(EBookLanguage), required: true },
    order: { type: Number, default: 0 },
    image: { type: String, default: null },
    thumbnail: { type: String, default: null },
    demoUrl: { type: String, default: null },
    bookUrl: { type: String, default: null },
    link: { type: String, required: true },
    termsAndConditions: { type: String, default: null },
    isTrending: { type: Boolean, default: false },
    status: { type: Boolean, default: true },
  },
  { timestamps: true }
);

ebookSchema.index({ status: 1, order: 1 });
ebookSchema.index({ examCountdownCategoryId: 1, status: 1, order: 1 });
ebookSchema.index({ status: 1, isTrending: 1, order: 1 });
ebookSchema.index(
  { author: "text", name: "text" },
  { default_language: "none", language_override: "_none" }
);

export const Ebook = mongoose.model<IEbook>("Ebook", ebookSchema, "ws_ebooks");
