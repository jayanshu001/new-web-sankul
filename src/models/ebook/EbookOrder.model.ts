import mongoose, { Schema, Document } from "mongoose";
import { PackageCourseEbookOrderStatus, PackageCourseEbookOrderType, PaymentMethod } from "../enums";

export interface IEbookOrder extends Document {
  customerId: mongoose.Types.ObjectId;
  ebookId: mongoose.Types.ObjectId;
  planId?: mongoose.Types.ObjectId | null;
  paymentMethod: PaymentMethod;
  orderType: PackageCourseEbookOrderType;
  orderPrice: number;
  razorpayOrderId?: string | null;
  razorpayPaymentId?: string | null;
  ipAddress?: string | null;
  transactionId?: string | null;
  status: PackageCourseEbookOrderStatus;
  createdAt: Date;
  updatedAt: Date;
}

const ebookOrderSchema: Schema = new Schema(
  {
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    ebookId: { type: Schema.Types.ObjectId, ref: "Ebook", required: true },
    planId: { type: Schema.Types.ObjectId, ref: "EbookPrice", default: null },
    paymentMethod: { type: String, enum: Object.values(PaymentMethod), required: true },
    orderType: { type: String, enum: Object.values(PackageCourseEbookOrderType), default: PackageCourseEbookOrderType.PURCHASE },
    orderPrice: { type: Number, required: true },
    razorpayOrderId: { type: String, default: null },
    razorpayPaymentId: { type: String, default: null },
    ipAddress: { type: String, default: null },
    transactionId: { type: String, default: null },
    status: { type: String, enum: Object.values(PackageCourseEbookOrderStatus), default: PackageCourseEbookOrderStatus.PENDING },
  },
  { timestamps: true }
);

ebookOrderSchema.index({ customerId: 1 });
ebookOrderSchema.index({ ebookId: 1 });

export const EbookOrder = mongoose.model<IEbookOrder>("EbookOrder", ebookOrderSchema, "ws_ebook_orders");
