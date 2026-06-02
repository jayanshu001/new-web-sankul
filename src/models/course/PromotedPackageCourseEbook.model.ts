import mongoose, { Schema, Document } from "mongoose";

// Which collection a link's `planId` points at. Package/course plans live in
// `PackageCourseEbookPrice` ("price"); live-course plans live in `LiveCoursePlan`
// ("livePlan"). Legacy rows predate this field and are all "price".
export type PromotedPlanKind = "price" | "livePlan";

export interface IPromotedPackageCourseEbook extends Document {
  planId: mongoose.Types.ObjectId;
  planKind: PromotedPlanKind;
  promocodeId: mongoose.Types.ObjectId;
  customerPercentage: number;
  promoterPercentage: number;
  createdAt: Date;
  updatedAt: Date;
}

const promotedPackageCourseEbookSchema: Schema = new Schema(
  {
    // No static `ref` — the target collection depends on `planKind`, so callers
    // populate against the right model explicitly (see promocode admin controller).
    planId: { type: Schema.Types.ObjectId, required: true },
    planKind: { type: String, enum: ["price", "livePlan"], default: "price" },
    promocodeId: { type: Schema.Types.ObjectId, ref: "PromoCode", required: true },
    customerPercentage: { type: Number, default: 0 },
    promoterPercentage: { type: Number, default: 0 },
  },
  { timestamps: true }
);

promotedPackageCourseEbookSchema.index({ planId: 1 });
promotedPackageCourseEbookSchema.index({ promocodeId: 1 });
promotedPackageCourseEbookSchema.index({ promocodeId: 1, planId: 1 }, { unique: true });

export const PromotedPackageCourseEbook = mongoose.model<IPromotedPackageCourseEbook>(
  "PromotedPackageCourseEbook",
  promotedPackageCourseEbookSchema,
  "ws_promoted_package_course_ebooks"
);
