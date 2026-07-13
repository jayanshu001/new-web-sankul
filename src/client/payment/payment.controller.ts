import { Request, Response } from "express";
import { getRazorpay, razorpayResponseFor, createRazorpayOrder } from "./razorpay";
import logger from "../../utils/logger";
import {
  previewBookOrderFromCartMysql,
  writeBookOrderMysql,
} from "../../modules/book-order/book-order.service";

/** Non-null Razorpay client (the controller has already null-checked it). */
type RazorpayClient = NonNullable<ReturnType<typeof getRazorpay>>;

// POST /api/v1/client/payment/create-order
// Reads the customer's active book cart, creates a local BookOrder (PENDING),
// then a Razorpay order, stores the razorpayOrderId on the BookOrder, and
// returns the bits the app needs to launch the Razorpay checkout.
export const createBookOrderPayment = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("createBookOrderPayment invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) { logger.warn("createBookOrderPayment unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const rp = getRazorpay();
    if (!rp) {
      logger.error("createBookOrderPayment razorpay not configured", { traceId, customerId });
      return res.status(500).json({
        success: false,
        message: "Razorpay credentials not configured on the server.",
      });
    }

    // ── MySQL book write path (book-order) ───────────────────────────────────
    const customerIdInt = Number(customerId); // C3 seam
    if (!Number.isInteger(customerIdInt)) {
      logger.warn("createBookOrderPayment[mysql] non-int customer id", { traceId, customerId });
      return res.status(400).json({ success: false, message: "Invalid customer id." });
    }
    return createBookOrderMysqlPath(req, res, { traceId, customerId: customerIdInt, rp });
  } catch (e: any) {
    // Razorpay's SDK errors often arrive as { statusCode, error: { description } }
    // and Mongo validation errors come with .errors. Surface the most useful
    // string we can find so the next 500 actually tells us what blew up.
    const message =
      e?.error?.description ||
      e?.message ||
      (typeof e === "string" ? e : "Unknown error creating payment order.");
    logger.error("createBookOrderPayment failed", { traceId, customerId, error: message, stack: e?.stack });
    return res.status(500).json({ success: false, message });
  }
};

// MySQL book create-order. Phase 1: preview the cart (validate + totals + priced
// items). Phase 2: create the Razorpay order, then write the pending order + item
// rows. Same response shape as the Mongo branch (bookOrderId = MySQL order id).
const createBookOrderMysqlPath = async (
  req: Request,
  res: Response,
  ctx: { traceId?: string; customerId: number; rp: RazorpayClient }
) => {
  const { traceId, customerId, rp } = ctx;

  const preview = await previewBookOrderFromCartMysql(customerId);
  if (!preview.ok) {
    const map: Record<typeof preview.code, { status: number; message: string }> = {
      EMPTY_CART: { status: 400, message: "Cart is empty." },
      NO_SHIPPING: { status: 400, message: "Shipping address is required before payment." },
      UNAVAILABLE: { status: 400, message: "One or more books in the cart are unavailable." },
      ZERO_AMOUNT: { status: 400, message: "Order amount is zero — use the free-checkout flow instead." },
    };
    const r = map[preview.code];
    logger.warn("createBookOrderPayment[mysql] precondition", { traceId, customerId, code: preview.code });
    return res.status(r.status).json({ success: false, message: r.message });
  }

  const { amount, breakdown } = preview.preview;
  const receiptId = `books-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const rzpOrder = await createRazorpayOrder(rp, {
    amount: Math.round(amount * 100), // paise
    currency: "INR",
    receipt: receiptId,
    notes: { bookOrderKey: receiptId, customerId: String(customerId) },
  });

  const { orderId } = await writeBookOrderMysql({
    customerId,
    orderKey: receiptId,
    preview: preview.preview,
    razorpayOrderId: rzpOrder.id,
    razorpayOrderPayload: JSON.stringify(rzpOrder),
    userIp: req.ip ?? null, // client IP → ws_book_order.user_ip
  });

  logger.info("createBookOrderPayment[mysql] success", { traceId, customerId, orderId, razorpayOrderId: rzpOrder.id, amount });
  return res.status(201).json({
    success: true,
    data: {
      bookOrderId: String(orderId),
      receiptId,
      razorpay: razorpayResponseFor(rzpOrder),
      amountInRupees: amount,
      breakdown: {
        totalListPrice: breakdown.totalListPrice,
        totalDiscountedPrice: breakdown.totalDiscountedPrice,
        shipping: breakdown.shipping,
        shippingWaived: breakdown.shippingWaived,
      },
    },
  });
};
