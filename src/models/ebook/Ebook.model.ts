import mongoose, { Schema, Document } from "mongoose";
import { EBookLanguage } from "../enums";

export interface IEbook extends Document {
  name: string;
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
  status: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ebookSchema: Schema = new Schema(
  {
    name: { type: String, required: true },
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
    status: { type: Boolean, default: true },
  },
  { timestamps: true }
);

ebookSchema.index({ status: 1, order: 1 });
ebookSchema.index({ author: "text", name: "text" });

export const Ebook = mongoose.model<IEbook>("Ebook", ebookSchema, "ws_ebooks");
