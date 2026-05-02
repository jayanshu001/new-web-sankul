import mongoose, { Schema, Document, Types } from "mongoose";

export interface IPackageCategoryRef {
  category: Types.ObjectId;
  order: number;
  status: boolean;
}

export interface IPackage extends Document {
  name: string;
  description: string;
  image?: string;
  shareableLink?: string;
  withMaterialText?: string;
  withoutMaterialText?: string;
  order: number;
  active: boolean;
  isMagazine: boolean;
  isPaid: boolean;
  packageTypeId?: Types.ObjectId | null;
  goalId?: Types.ObjectId | null;
  goalLabelId?: Types.ObjectId | null;
  pcMaterialId?: Types.ObjectId | null;
  educatorId?: Types.ObjectId | null;
  specificSubjects: IPackageCategoryRef[];
  materialCategories: IPackageCategoryRef[];
  examCategories: IPackageCategoryRef[];
  notificationTopic?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PackageCategoryRefSchema = new Schema<IPackageCategoryRef>(
  {
    category: { type: Schema.Types.ObjectId, required: true },
    order: { type: Number, default: 0 },
    status: { type: Boolean, default: true },
  },
  { _id: false }
);

const packageSchema = new Schema<IPackage>(
  {
    name: { type: String, required: true, maxlength: 255 },
    description: { type: String, default: "" },
    image: { type: String, maxlength: 500 },
    shareableLink: { type: String, maxlength: 500 },
    withMaterialText: { type: String, default: "" },
    withoutMaterialText: { type: String, default: "" },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    isMagazine: { type: Boolean, default: false },
    isPaid: { type: Boolean, default: true },
    packageTypeId: { type: Schema.Types.ObjectId, ref: "PackageType", default: null },
    goalId: { type: Schema.Types.ObjectId, ref: "Goal", default: null },
    goalLabelId: { type: Schema.Types.ObjectId, default: null },
    pcMaterialId: {
      type: Schema.Types.ObjectId,
      ref: "PackageCourseMaterial",
      default: null,
    },
    educatorId: { type: Schema.Types.ObjectId, ref: "CourseEducator", default: null },
    specificSubjects: { type: [PackageCategoryRefSchema], default: [] },
    materialCategories: { type: [PackageCategoryRefSchema], default: [] },
    examCategories: { type: [PackageCategoryRefSchema], default: [] },
    notificationTopic: { type: String, maxlength: 255 },
  },
  { collection: "ws_packages", timestamps: true }
);

packageSchema.index({ active: 1, order: 1 });
packageSchema.index({ goalId: 1, active: 1 });
packageSchema.index({ goalLabelId: 1, active: 1 });
packageSchema.index({ packageTypeId: 1, active: 1 });
packageSchema.index({ "specificSubjects.category": 1 });
packageSchema.index({ "materialCategories.category": 1 });
packageSchema.index({ "examCategories.category": 1 });

export const Package = mongoose.model<IPackage>("Package", packageSchema);
