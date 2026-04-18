import mongoose, { Schema, Document } from "mongoose";

export interface IPromotedPackageCourseEbook extends Document {
  planId: mongoose.Types.ObjectId;
  promocodeId: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const promotedPackageCourseEbookSchema: Schema = new Schema(
  {
    planId: { type: Schema.Types.ObjectId, ref: "PackageCourseEbookPrice", required: true },
    promocodeId: { type: Schema.Types.ObjectId, ref: "PromoCode", required: true },
  },
  { timestamps: true }
);

promotedPackageCourseEbookSchema.index({ planId: 1 });
promotedPackageCourseEbookSchema.index({ promocodeId: 1 });

export const PromotedPackageCourseEbook = mongoose.model<IPromotedPackageCourseEbook>(
  "PromotedPackageCourseEbook",
  promotedPackageCourseEbookSchema,
  "ws_promoted_package_course_ebooks"
);
