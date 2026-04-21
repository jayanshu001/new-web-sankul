import { Schema, model, Document, Types } from "mongoose";

export type WishlistItemType = "course" | "package" | "ebook" | "book";

export interface IWishlist extends Document {
  customerId: Types.ObjectId;
  itemType: WishlistItemType;
  itemId: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

const WishlistSchema = new Schema<IWishlist>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    itemType: {
      type: String,
      enum: ["course", "package", "ebook", "book"],
      required: true,
    },
    itemId: { type: Schema.Types.ObjectId, required: true },
  },
  { collection: "ws_wishlists", timestamps: true }
);

WishlistSchema.index(
  { customerId: 1, itemType: 1, itemId: 1 },
  { unique: true }
);
WishlistSchema.index({ customerId: 1, createdAt: -1 });

export const Wishlist = model<IWishlist>("Wishlist", WishlistSchema);
