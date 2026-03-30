import { Schema, model, Document } from "mongoose";

export interface IDynamicImage extends Document {
  logo: string;
}

const DynamicImageSchema = new Schema<IDynamicImage>(
  {
    logo: { type: String, required: true },
  },
  { collection: "ws_dynamic_images", timestamps: false }
);

export const DynamicImage = model<IDynamicImage>("DynamicImage", DynamicImageSchema);
