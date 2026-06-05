import { Schema, model, Document, Types } from "mongoose";
import { BookLanguage } from "../enums";

export interface IBook extends Document {
  name: string;
  examCountdownCategoryId?: Types.ObjectId | null;
  // Packages this physical book is offered as material for. Many-to-many:
  // a book can belong to several packages and a package to several books.
  // Stored on the Book (mirrors PromoCode.appliesTo.ids) so the package
  // detail "material (Book)" tab can query `{ packageIds: <pkgId> }`.
  packageIds: Types.ObjectId[];
  thumbnail?: string;
  author?: string;
  image?: string;
  description?: string;
  termsAndConditions?: string;
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
    packageIds: {
      type: [Schema.Types.ObjectId],
      ref: "Package",
      default: [],
    },
    thumbnail: { type: String, maxlength: 500 },
    author: { type: String, maxlength: 150 },
    image: { type: String, maxlength: 500 },
    description: { type: String },
    // Rich-text HTML (no length cap), mirrors the Ebook model's field.
    termsAndConditions: { type: String, default: null },
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
// Supports the package detail "material (Book)" tab: books linked to a package.
BookSchema.index({ packageIds: 1, status: 1, orderBy: 1 });
// The Book has a `language` field (e.g. "Gujarati") that is plain metadata.
// Without `language_override`, Mongo's text index treats that field as the
// per-document text-search language override, and "Gujarati" isn't a supported
// text-search language — so any insert/update fails with
// "language override unsupported: Gujarati". Pointing the override at a
// non-existent field (`_none`) and defaulting to "none" decouples the metadata
// `language` from the text index. Mirrors the Ebook model's text index.
BookSchema.index(
  { name: "text", author: "text" },
  { default_language: "none", language_override: "_none" }
);

export const Book = model<IBook>("Book", BookSchema);
