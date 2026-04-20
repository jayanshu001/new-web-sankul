import { Schema, model, Document, Types } from "mongoose";

export interface IBookCartItem {
  bookId: Types.ObjectId;
  qty: number;
}

export interface IBookCart extends Document {
  customerId: Types.ObjectId;
  items: IBookCartItem[];
  shippingId?: Types.ObjectId | null;
  status: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const BookCartItemSchema = new Schema<IBookCartItem>(
  {
    bookId: { type: Schema.Types.ObjectId, ref: "Book", required: true },
    qty: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const BookCartSchema = new Schema<IBookCart>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    items: { type: [BookCartItemSchema], default: [] },
    shippingId: { type: Schema.Types.ObjectId, ref: "CustomerShipping", default: null },
    status: { type: Boolean, default: true },
  },
  { collection: "ws_book_carts", timestamps: true }
);

BookCartSchema.index({ customerId: 1, status: 1 }, { unique: true, partialFilterExpression: { status: true } });

export const BookCart = model<IBookCart>("BookCart", BookCartSchema);
