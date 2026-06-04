import { Schema, model, Document, Types } from "mongoose";

export type BannerKey = "Packages" | "Courses" | "Book" | "EBook" | "Explore";

// `Explore` has no linked collection (it's a standalone CTA banner), so it is
// intentionally absent here — bannerTransform leaves keyRef/keyId unset for it.
export const BANNER_KEY_TO_MODEL: Partial<Record<BannerKey, string>> = {
  Packages: "Package",
  Courses: "Course",
  Book: "Book",
  EBook: "Ebook",
};

export interface IBannerSlider extends Document {
  image: string;
  key?: BannerKey;
  keyId?: Types.ObjectId;
  keyRef?: string;
  orderBy: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const BannerSliderSchema = new Schema<IBannerSlider>(
  {
    image: { type: String, required: true, maxlength: 255 },
    key: { type: String, enum: ["Packages", "Courses", "Book", "EBook", "Explore"] },
    keyId: { type: Schema.Types.ObjectId, refPath: "keyRef" },
    keyRef: { type: String, enum: ["Package", "Course", "Book", "Ebook"] },
    orderBy: { type: Number, required: true },
  },
  { collection: "ws_banner_sliders", timestamps: true }
);

BannerSliderSchema.index({ key: 1, keyId: 1 });

export const BannerSlider = model<IBannerSlider>("BannerSlider", BannerSliderSchema);
