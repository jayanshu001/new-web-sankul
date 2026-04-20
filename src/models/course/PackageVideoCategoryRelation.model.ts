import mongoose, { Schema, Document, Types } from "mongoose";

export interface IPackageVideoCategoryRelation extends Document {
  packageId: Types.ObjectId;
  videoCategoryRelationId: Types.ObjectId;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IPackageVideoCategoryRelation>(
  {
    packageId: { type: Schema.Types.ObjectId, ref: "Package", required: true },
    videoCategoryRelationId: {
      type: Schema.Types.ObjectId,
      ref: "VideoCategoryRelation",
      required: true,
    },
    active: { type: Boolean, default: true },
  },
  { collection: "ws_package_video_category_relations", timestamps: true }
);

schema.index({ packageId: 1, videoCategoryRelationId: 1 }, { unique: true });
schema.index({ packageId: 1, active: 1 });

export const PackageVideoCategoryRelation = mongoose.model<IPackageVideoCategoryRelation>(
  "PackageVideoCategoryRelation",
  schema
);
