import { Request, Response } from "express";
import { z } from "zod";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { getClientIp } from "../../utils/clientIp";
import * as cartSql from "../../modules/client-cart/client-cart.service";

// On the SQL branch ids are numeric strings, not ObjectIds.
const numericId = z.string().regex(/^[1-9]\d*$/, "Invalid id");
const sqlAddSchema = z.object({ bookId: numericId, qty: z.number().int().min(1).max(99).optional().default(1) });

const updateQtySchema = z.object({
  qty: z.number().int().min(1).max(99),
});

// POST /api/v1/client/cart
// Adds a book to the active cart. If the book is already in the cart, increments qty.
export const addToCart = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("addToCart invoked", { traceId, path: req.originalUrl, customerId: userId });

  try {
    if (!userId) {
      logger.warn("addToCart unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    // ─── MySQL (ws_book_cart + ws_book_cart_item) ──────────────────
    const cid = cartSql.parseCartId(userId);
    const { bookId, qty } = sqlAddSchema.parse(req.body);
    const numBook = cartSql.parseCartId(bookId);
    if (!cid || !numBook) return res.status(400).json({ success: false, message: "Invalid id." });
    const r = await cartSql.addToCart(cid, numBook, qty, getClientIp(req));
    if (!r.ok) return res.status(404).json({ success: false, message: "Book not found." });
    return res.status(r.created ? 201 : 200).json({ success: true, data: r.data, message: r.created ? "Added to cart." : "Quantity updated." });
  } catch (e: any) {
    if (e.issues) {
      logger.warn("addToCart validation failed", { traceId, customerId: userId, issues: e.issues });
      return res.status(400).json({ success: false, errors: e.issues });
    }
    logger.error("addToCart failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// PATCH /api/v1/client/cart/items/:bookId
// Sets the line's qty to an absolute value (1..99). Use DELETE to remove a line.
export const updateCartItemQty = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("updateCartItemQty invoked", { traceId, path: req.originalUrl, customerId: userId, bookId: req.params.bookId });

  try {
    if (!userId) {
      logger.warn("updateCartItemQty unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    // ─── MySQL ─────────────────────────────────────────────────────
    const cid = cartSql.parseCartId(userId);
    const numBook = cartSql.parseCartId(String(req.params.bookId));
    const { qty } = updateQtySchema.parse(req.body);
    if (!cid || !numBook) return res.status(400).json({ success: false, message: "Invalid id." });
    const r = await cartSql.updateCartItemQty(cid, numBook, qty);
    if (!r.ok) return res.status(404).json({ success: false, message: "Item not in cart." });
    return res.status(200).json({ success: true, data: r.data, message: "Quantity updated." });
  } catch (e: any) {
    if (e.issues) {
      logger.warn("updateCartItemQty validation failed", { traceId, customerId: userId, issues: e.issues });
      return res.status(400).json({ success: false, errors: e.issues });
    }
    logger.error("updateCartItemQty failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// DELETE /api/v1/client/cart/items/:bookId
// Removes a single line from the active cart.
export const removeCartItem = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("removeCartItem invoked", { traceId, path: req.originalUrl, customerId: userId, bookId: req.params.bookId });

  try {
    if (!userId) {
      logger.warn("removeCartItem unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    // ─── MySQL ─────────────────────────────────────────────────────
    const cid = cartSql.parseCartId(userId);
    const numBook = cartSql.parseCartId(String(req.params.bookId));
    if (!cid || !numBook) return res.status(400).json({ success: false, message: "Invalid id." });
    const r = await cartSql.removeCartItem(cid, numBook);
    if (!r.ok) return res.status(404).json({ success: false, message: "Item not in cart." });
    return res.status(200).json({ success: true, data: r.data, message: "Removed from cart." });
  } catch (e: any) {
    if (e.issues) {
      logger.warn("removeCartItem validation failed", { traceId, customerId: userId, issues: e.issues });
      return res.status(400).json({ success: false, errors: e.issues });
    }
    logger.error("removeCartItem failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// POST /api/v1/client/cart/shipping
// Attaches a saved address to the active cart for delivery.
export const attachShippingToCart = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("attachShippingToCart invoked", { traceId, path: req.originalUrl, customerId: userId });

  try {
    if (!userId) {
      logger.warn("attachShippingToCart unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const cid = cartSql.parseCartId(userId);
    const numAddr = cartSql.parseCartId(String((req.body ?? {}).addressId ?? ""));
    if (!cid || !numAddr) return res.status(400).json({ success: false, message: "Invalid address id." });
    const r = await cartSql.attachShipping(cid, numAddr, getClientIp(req));
    if (!r.ok) {
      if (r.reason === "address") return res.status(404).json({ success: false, message: "Address not found." });
      if (r.reason === "phone") return res.status(400).json({ success: false, message: "No phone number on file. Please update your profile before using this address for delivery." });
      return res.status(400).json({ success: false, message: "Address is missing a city. Please update the address before using it for delivery." });
    }
    // Return the recalculated pricing too, so the client needs ONE call (no
    // attach + re-GET dance). Shipping uses the same free-shipping logic as
    // /cart and create-order, so all three agree.
    const priced = await cartSql.getCart(cid);
    return res.status(200).json({
      success: true,
      data: { cart: r.cart, shipping: r.shipping, summary: priced.summary },
      message: "Shipping address attached.",
    });
  } catch (e: any) {
    if (e.issues) {
      logger.warn("attachShippingToCart validation failed", { traceId, customerId: userId, issues: e.issues });
      return res.status(400).json({ success: false, errors: e.issues });
    }
    logger.error("attachShippingToCart failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/cart
// Returns the customer's active cart with each item populated and a total summary.
export const getCart = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("getCart invoked", { traceId, path: req.originalUrl, customerId: userId });

  try {
    if (!userId) {
      logger.warn("getCart unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const cid = cartSql.parseCartId(userId);
    if (!cid) return res.status(401).json({ success: false, message: "Unauthorized." });
    const data = await cartSql.getCart(cid);
    logger.info("getCart success (sql)", { traceId, customerId: userId, itemCount: data.summary.itemCount });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("getCart failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
