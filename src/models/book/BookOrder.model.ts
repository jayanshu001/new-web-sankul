import { Schema, model, Document, Types } from "mongoose";
import { BookOrderStatus, BookCourier, PaymentMethod, BookOrderType } from "../enums";

export interface IBookOrderItem {
  bookId: Types.ObjectId;
  name: string;
  qty: number;
  listPrice: number;
  price: number;
  shippingPrice: number;
  weight?: number;
  isMagazine?: boolean;
}

export interface IBookOrderTracking {
  trackingId?: string;
  courier?: BookCourier;
  status: string;
  history: { status: string; location?: string; note?: string; at: Date }[];
}

export interface IBookOrder extends Document {
  receiptId: string;
  customerId: Types.ObjectId;
  shippingId: Types.ObjectId;
  items: IBookOrderItem[];
  orderType: BookOrderType;
  paymentMethod: PaymentMethod;
  totalListPrice: number;
  totalDiscountedPrice: number;
  totalShippingPrice: number;
  amount: number;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  razorpayOrderPayload?: Record<string, any>;
  status: BookOrderStatus;
  tracking: IBookOrderTracking;
  paidAt?: Date;
  shippedAt?: Date;
  deliveredAt?: Date;
  cancelledAt?: Date;
  remarks?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const BookOrderItemSchema = new Schema<IBookOrderItem>(
  {
    bookId: { type: Schema.Types.ObjectId, ref: "Book", required: true },
    name: { type: String, required: true },
    qty: { type: Number, required: true, min: 1 },
    listPrice: { type: Number, required: true, min: 0 },
    price: { type: Number, required: true, min: 0 },
    shippingPrice: { type: Number, required: true, min: 0, default: 0 },
    weight: { type: Number, default: 0 },
    isMagazine: { type: Boolean, default: false },
  },
  { _id: false }
);

const BookOrderSchema = new Schema<IBookOrder>(
  {
    receiptId: { type: String, required: true, unique: true, maxlength: 50 },
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    shippingId: { type: Schema.Types.ObjectId, ref: "CustomerShipping", required: true },
    items: { type: [BookOrderItemSchema], required: true },
    orderType: { type: String, default: "purchase" },
    paymentMethod: { type: String, required: true },
    totalListPrice: { type: Number, required: true, min: 0 },
    totalDiscountedPrice: { type: Number, required: true, min: 0 },
    totalShippingPrice: { type: Number, required: true, min: 0, default: 0 },
    amount: { type: Number, required: true, min: 0 },
    razorpayOrderId: { type: String, maxlength: 100 },
    razorpayPaymentId: { type: String, maxlength: 100 },
    razorpayOrderPayload: { type: Schema.Types.Mixed },
    status: {
      type: String,
      enum: Object.values(BookOrderStatus),
      default: BookOrderStatus.PENDING,
      required: true,
    },
    tracking: {
      trackingId: { type: String, maxlength: 100 },
      courier: { type: String, enum: Object.values(BookCourier) },
      status: { type: String, default: "pending" },
      history: {
        type: [
          {
            status: { type: String, required: true },
            location: { type: String },
            note: { type: String },
            at: { type: Date, default: Date.now },
          },
        ],
        default: [],
      },
    },
    paidAt: { type: Date },
    shippedAt: { type: Date },
    deliveredAt: { type: Date },
    cancelledAt: { type: Date },
    remarks: { type: String, maxlength: 500 },
  },
  { collection: "ws_book_orders", timestamps: true }
);

BookOrderSchema.index({ customerId: 1, createdAt: -1 });
BookOrderSchema.index({ status: 1, createdAt: -1 });
BookOrderSchema.index({ razorpayOrderId: 1 }, { sparse: true });

export const BookOrder = model<IBookOrder>("BookOrder", BookOrderSchema);
