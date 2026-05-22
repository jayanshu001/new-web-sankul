import { Request, Response } from "express";
import { BookCart } from "../../models/book/BookCart.model";
import { BookOrder } from "../../models/book/BookOrder.model";
import { Book } from "../../models/book/Book.model";
import { BookSetting } from "../../models/book/BookSetting.model";
import { BookOrderStatus, PaymentMethod } from "../../models/enums";
import { getRazorpay, razorpayResponseFor, createRazorpayOrder } from "./razorpay";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

const computeTotals = (
  items: { bookId: any; qty: number }[],
  books: any[],
  freeShippingMin: number
) => {
  const byId = new Map(books.map((b) => [String(b._id), b]));
  let totalListPrice = 0;
  let totalDiscountedPrice = 0;
  let rawShipping = 0;
  for (const line of items) {
    const b = byId.get(String(line.bookId));
    if (!b) continue;
    totalListPrice += (b.listPrice ?? 0) * line.qty;
    totalDiscountedPrice += (b.discountedPrice ?? 0) * line.qty;
    rawShipping += (b.shippingPrice ?? 0) * line.qty;
  }
  const shippingWaived =
    freeShippingMin > 0 && totalDiscountedPrice >= freeShippingMin;
  const effectiveShipping = shippingWaived ? 0 : rawShipping;
  return {
    totalListPrice,
    totalDiscountedPrice,
    effectiveShipping,
    shippingWaived,
    finalAmount: totalDiscountedPrice + effectiveShipping,
  };
};

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

    const cart = await BookCart.findOne({ customerId, status: true });
    if (!cart || cart.items.length === 0) { logger.warn("createBookOrderPayment empty cart", { traceId, customerId }); return res.status(400).json({ success: false, message: "Cart is empty." }); }
    if (!cart.shippingId) {
      logger.warn("createBookOrderPayment missing shipping", { traceId, customerId, cartId: cart._id });
      return res.status(400).json({
        success: false,
        message: "Shipping address is required before payment.",
      });
    }

    const bookIds = cart.items.map((i) => i.bookId);
    const books = await Book.find({ _id: { $in: bookIds }, status: true });
    if (books.length !== bookIds.length) {
      logger.warn("createBookOrderPayment unavailable books", { traceId, customerId, expected: bookIds.length, got: books.length });
      return res.status(400).json({
        success: false,
        message: "One or more books in the cart are unavailable.",
      });
    }

    const setting = await BookSetting.findOne({ key: "default" }).select("freeShippingMinOrderAmount");
    const freeShippingMin = setting?.freeShippingMinOrderAmount ?? 0;
    const totals = computeTotals(
      cart.items,
      books.map((b) => b.toObject()),
      freeShippingMin
    );

    if (totals.finalAmount <= 0) {
      logger.warn("createBookOrderPayment zero amount", { traceId, customerId });
      return res.status(400).json({
        success: false,
        message: "Order amount is zero — use the free-checkout flow instead.",
      });
    }

    const bookMap = new Map(books.map((b) => [String(b._id), b]));
    const orderItems = cart.items.map((line) => {
      const b = bookMap.get(String(line.bookId))!;
      return {
        bookId: b._id,
        name: b.name,
        qty: line.qty,
        listPrice: b.listPrice,
        price: b.discountedPrice,
        shippingPrice: totals.shippingWaived ? 0 : b.shippingPrice,
        weight: b.weight ?? 0,
        isMagazine: b.isMagazine,
      };
    });

    const receiptId = `books-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const bookOrder = await BookOrder.create({
      receiptId,
      customerId,
      shippingId: cart.shippingId,
      items: orderItems,
      orderType: "purchase",
      paymentMethod: PaymentMethod.RAZORPAY,
      totalListPrice: totals.totalListPrice,
      totalDiscountedPrice: totals.totalDiscountedPrice,
      totalShippingPrice: totals.effectiveShipping,
      amount: totals.finalAmount,
      status: BookOrderStatus.PENDING,
      tracking: { status: "pending", history: [] },
    });

    // Razorpay outside the txn — external call shouldn't hold a DB session open.
    // `receipt` is what Razorpay shows in their dashboard to correlate with our row.
    const rzpOrder = await createRazorpayOrder(rp, {
      amount: Math.round(totals.finalAmount * 100), // paise
      currency: "INR",
      receipt: receiptId,
      notes: {
        bookOrderId: String(bookOrder._id),
        customerId: String(customerId),
      },
    });

    bookOrder.razorpayOrderId = rzpOrder.id;
    bookOrder.razorpayOrderPayload = rzpOrder as any;
    await bookOrder.save();

    logger.info("createBookOrderPayment success", { traceId, customerId, bookOrderId: bookOrder._id, razorpayOrderId: rzpOrder.id, amount: totals.finalAmount });
    return res.status(201).json({
      success: true,
      data: {
        bookOrderId: bookOrder._id,
        receiptId,
        razorpay: razorpayResponseFor(rzpOrder),
        amountInRupees: totals.finalAmount,
        breakdown: {
          totalListPrice: totals.totalListPrice,
          totalDiscountedPrice: totals.totalDiscountedPrice,
          shipping: totals.effectiveShipping,
          shippingWaived: totals.shippingWaived,
        },
      },
    });
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
