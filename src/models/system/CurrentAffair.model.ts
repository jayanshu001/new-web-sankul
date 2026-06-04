import { Schema, model, Document } from "mongoose";

// "Free Current Affair" — an admin-curated content block shown inline on the
// client home screen. Exactly three editable fields (image, title,
// youtubeLink) plus a `status` visibility flag. No detail page / View All.
export interface ICurrentAffair extends Document {
  title: string;
  image: string; // hosted S3/CDN URL
  youtubeLink: string;
  status: boolean; // true = visible on client
  createdAt?: Date;
  updatedAt?: Date;
}

const CurrentAffairSchema = new Schema<ICurrentAffair>(
  {
    title: { type: String, required: true, trim: true, maxlength: 255 },
    image: { type: String, required: true },
    youtubeLink: { type: String, required: true, trim: true },
    status: { type: Boolean, default: true },
  },
  { collection: "ws_current_affairs", timestamps: true }
);

CurrentAffairSchema.index({ status: 1, createdAt: -1 });

export const CurrentAffair = model<ICurrentAffair>(
  "CurrentAffair",
  CurrentAffairSchema
);
