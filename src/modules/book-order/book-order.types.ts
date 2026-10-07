// Book orders: DTO and input types.
/**
 * ws_book_order.order_id is a VARCHAR business key distinct from the int PK;
 * ws_book_order_item and ws_book_tracking reference it. Line items are also
 * written as JSON to the NOT NULL `order_items` TEXT column.
 *
 * The AWB is ws_book_tracking.tracking_id, a BIGINT AUTO_INCREMENT allocated by
 * inserting a tracking row on verify (~1.19e11, surfaced as a JS number).
 */

export interface BookOrderItemDto {
  bookId: string | null;
  qty: number;
  listPrice: number;
  price: number;
  shippingPrice: number;
}

export interface BookOrderTrackingDto {
  trackingId: number | null;
  status: string;
  /** Synthesized from the flat status; there are no history columns. */
  history: { status: string; note?: string; at: Date | null }[];
}

export interface BookOrderDto {
  _id: string;
  /** order_id, the VARCHAR business key. */
  receiptId: string;
  customerId: number;
  shippingId: string | null;
  items: BookOrderItemDto[];
  amount: number;
  status: string;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  tracking: BookOrderTrackingDto;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface BookOrderItemBookDto {
  _id: string;
  name: string;
  thumbnail: string | null;
  author: string | null;
}

/** `bookId` is a string on the list and a populated book on the detail view. */
export interface MyOrderItemDto {
  bookId: string | BookOrderItemBookDto | null;
  qty: number;
  listPrice: number;
  price: number;
  shippingPrice: number;
}

/** `stateId` is the raw int FK; there is no nested state doc. */
export interface MyOrderShippingDto {
  _id: string;
  name: string | null;
  phone: string | null;
  alternatePhone: string | null;
  email: string | null;
  address: string | null;
  address2: string | null;
  city: string | null;
  stateId: string | null;
  pincode: string | null;
  status: boolean | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/** `shippingId` is a string on the list and a populated object on the detail view. */
export interface MyOrderDto {
  _id: string;
  receiptId: string;
  customerId: number;
  shippingId: string | MyOrderShippingDto | null;
  items: MyOrderItemDto[];
  orderType: string;
  paymentMethod: string;
  amount: number;
  status: string;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  tracking: BookOrderTrackingDto;
  paidAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  trackingUrl: string | null;
}

export interface BookOrderRow {
  id: number;
  /** VARCHAR business key (order_id); child tables and tracking reference it. */
  orderKey: string;
  customerId: number;
  shippingId: number | null;
  status: string;
  razorpayOrderId: string | null;
  trackingId: bigint | null;
}

export interface CreateOrderItemInput {
  bookId: number;
  qty: number;
  listPrice: number;
  price: number;
  shippingPrice: number;
}

export interface CreatedBookOrder {
  orderId: number;
  orderKey: string;
}
