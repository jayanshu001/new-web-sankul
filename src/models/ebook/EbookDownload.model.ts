import mongoose, { Schema, Document } from "mongoose";

export interface IEbookDownload extends Document {
  customerId: mongoose.Types.ObjectId;
  ebookId: mongoose.Types.ObjectId;
  downloadedAt: Date;
}

const ebookDownloadSchema: Schema = new Schema<IEbookDownload>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    ebookId: { type: Schema.Types.ObjectId, ref: "Ebook", required: true },
    downloadedAt: { type: Date, default: Date.now },
  },
  { collection: "ws_ebook_downloads", timestamps: false }
);

ebookDownloadSchema.index({ customerId: 1, ebookId: 1 }, { unique: true });
ebookDownloadSchema.index({ customerId: 1, downloadedAt: -1 });

export const EbookDownload = mongoose.model<IEbookDownload>(
  "EbookDownload",
  ebookDownloadSchema
);
