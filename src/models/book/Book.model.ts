import { Schema, model, Document, Types } from "mongoose";
import { BookLanguage } from "../enums";

export interface IBook extends Document {
  name: string;
  examCountdownCategoryId?: Types.ObjectId | null;
  thumbnail?: string;
  author?: string;
  image?: string;
  description?: string;
  demoUrl?: string;
  bookUrl?: string;
  weight?: number;
  pages?: number;
  dynamicLink?: string;
  listPrice: number;
  discountedPrice: number;
  shippingPrice: number;
  orderBy: number;
  language: BookLanguage | string;
  isMagazine: boolean;
  isCombo: boolean;
  publication?: string;
  deliveryEta?: string;
  isTrending: boolean;
  status: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const BookSchema = new Schema<IBook>(
  {
    name: { type: String, required: true, maxlength: 255 },
    examCountdownCategoryId: {
      type: Schema.Types.ObjectId,
      ref: "ExamCountdownCategory",
      default: null,
    },
    thumbnail: { type: String, maxlength: 500 },
    author: { type: String, maxlength: 150 },
    image: { type: String, maxlength: 500 },
    description: { type: String },
    demoUrl: { type: String, maxlength: 500 },
    bookUrl: { type: String, maxlength: 500 },
    weight: { type: Number, default: 0 },
    pages: { type: Number, default: 0 },
    dynamicLink: { type: String, maxlength: 500 },
    listPrice: { type: Number, required: true, min: 0 },
    discountedPrice: { type: Number, required: true, min: 0 },
    shippingPrice: { type: Number, required: true, min: 0, default: 0 },
    orderBy: { type: Number, required: true, default: 0 },
    language: { type: String, default: BookLanguage.GUJARATI, maxlength: 50 },
    isMagazine: { type: Boolean, default: false },
    isCombo: { type: Boolean, default: false },
    publication: { type: String, default: "WebSankul Publication", maxlength: 150 },
    deliveryEta: { type: String, default: "5-7 days", maxlength: 100 },
    isTrending: { type: Boolean, default: false },
    status: { type: Boolean, default: true },
  },
  { collection: "ws_books", timestamps: true }
);

BookSchema.index({ status: 1, orderBy: 1 });
BookSchema.index({ examCountdownCategoryId: 1, status: 1, orderBy: 1 });
BookSchema.index({ status: 1, isTrending: 1, orderBy: 1 });
BookSchema.index({ name: "text", author: "text" });

export const Book = model<IBook>("Book", BookSchema);
