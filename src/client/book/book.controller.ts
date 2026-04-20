import { Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import { Book } from "../../models/book/Book.model";
import { BookCart } from "../../models/book/BookCart.model";
import { BookOrder } from "../../models/book/BookOrder.model";
import { BookSetting } from "../../models/book/BookSetting.model";
import { CustomerShipping } from "../../models/customer/CustomerShipping.model";
import { BookOrderStatus, BookCourier, PaymentMethod } from "../../models/enums";
import {
  addToCartSchema,
  updateCartItemSchema,
  attachShippingSchema,
  placeOrderSchema,
} from "./book.validation";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getOrCreateActiveCart(customerId: string) {
  let cart = await BookCart.findOne({ customerId, status: true });
  if (!cart) cart = await BookCart.create({ customerId, items: [], status: true });
  return cart;
}

async function getFreeShippingMin(): Promise<number> {
  const setting = await BookSetting.findOne({ key: "default" }).select("freeShippingMinOrderAmount");
  return setting?.freeShippingMinOrderAmount ?? 0;
}

function computeCartTotals(
  cartItems: { bookId: Types.ObjectId; qty: number }[],
  books: Array<{ _id: Types.ObjectId; listPrice: number; discountedPrice: number; shippingPrice: number }>,
  freeShippingMin: number
) {
  const bookMap = new Map(books.map((b) => [b._id.toString(), b]));
  let totalListPrice = 0;
  let totalDiscountedPrice = 0;
  let totalShippingPrice = 0;
  const lines = cartItems.map((item) => {
    const b = bookMap.get(item.bookId.toString());
    if (!b) return null;
    const list = b.listPrice * item.qty;
    const disc = b.discountedPrice * item.qty;
    const ship = b.shippingPrice * item.qty;
    totalListPrice += list;
    totalDiscountedPrice += disc;
    totalShippingPrice += ship;
    return { bookId: b._id, qty: item.qty, listPrice: b.listPrice, discountedPrice: b.discountedPrice, shippingPrice: b.shippingPrice };
  });
  const shippingWaived = freeShippingMin > 0 && totalDiscountedPrice >= freeShippingMin;
  const effectiveShipping = shippingWaived ? 0 : totalShippingPrice;
  const finalAmount = totalDiscountedPrice + effectiveShipping;
  return {
    lines,
    totals: {
      totalListPrice,
      totalDiscountedPrice,
      totalShippingPrice,
      effectiveShipping,
      shippingWaived,
      finalAmount,
      freeShippingMin,
    },
  };
}

function buildTrackingUrl(courier?: string, trackingId?: string): string | null {
  if (!courier || !trackingId) return null;
  if (courier === BookCourier.MAHAVIR) {
    return `http://shreemahavircourier.com/Frm_DocTrack.aspx?Tmp=${Date.now()}&docno=${trackingId}`;
  }
  if (courier === BookCourier.TIRUPATI) {
    return `http://shreetirupaticourier.net/DocTracking.aspx?Tmp=${Date.now()}&docno=${trackingId}`;
  }
  return null;
}

// ─── Catalogue ────────────────────────────────────────────────────────────────

export const listBooks = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    const { search, language } = req.query as Record<string, string>;

    const filter: any = { status: true };
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { author: { $regex: search, $options: "i" } },
      ];
    }
    if (language) filter.language = language;

    const books = await Book.find(filter).sort({ orderBy: 1, createdAt: -1 });

    let cartMap = new Map<string, number>();
    let cartId: string | null = null;
    if (customerId) {
      const cart = await BookCart.findOne({ customerId, status: true }).select("_id items");
      if (cart) {
        cartId = cart._id.toString();
        cart.items.forEach((i) => cartMap.set(i.bookId.toString(), i.qty));
      }
    }

    const decorated = books.map((b) => {
      const doc = b.toObject();
      return {
        ...doc,
        qty: cartMap.get(b._id.toString()) ?? 0,
        key: b.isCombo ? "combo" : "individual",
      };
    });

    return res.status(200).json({ success: true, data: { cartId, books: decorated } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getBookDetail = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid book id." });
    const book = await Book.findOne({ _id: id, status: true });
    if (!book) return res.status(404).json({ success: false, message: "Book not found." });
    return res.status(200).json({ success: true, data: book });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Cart ─────────────────────────────────────────────────────────────────────

export const getCart = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const cart = await BookCart.findOne({ customerId, status: true }).populate(
      "shippingId"
    );
    if (!cart || cart.items.length === 0) {
      return res.status(200).json({
        success: true,
        data: { cartId: cart?._id ?? null, items: [], shipping: cart?.shippingId ?? null, totals: null },
      });
    }

    const bookIds = cart.items.map((i) => i.bookId);
    const books = await Book.find({ _id: { $in: bookIds } });
    const freeShippingMin = await getFreeShippingMin();
    const { totals } = computeCartTotals(
      cart.items,
      books.map((b) => b.toObject()) as any,
      freeShippingMin
    );

    const bookMap = new Map(books.map((b) => [b._id.toString(), b]));
    const items = cart.items
      .map((i) => {
        const b = bookMap.get(i.bookId.toString());
        if (!b) return null;
        return {
          bookId: b._id,
          name: b.name,
          thumbnail: b.thumbnail,
          author: b.author,
          qty: i.qty,
          listPrice: b.listPrice,
          discountedPrice: b.discountedPrice,
          shippingPrice: b.shippingPrice,
          lineTotal: b.discountedPrice * i.qty,
        };
      })
      .filter(Boolean);

    return res.status(200).json({
      success: true,
      data: { cartId: cart._id, items, shipping: cart.shippingId ?? null, totals },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const addToCart = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const { bookId, qty } = addToCartSchema.parse(req.body);
    if (!mongoose.Types.ObjectId.isValid(bookId))
      return res.status(400).json({ success: false, message: "Invalid book id." });

    const book = await Book.findOne({ _id: bookId, status: true });
    if (!book) return res.status(404).json({ success: false, message: "Book not found." });

    const cart = await getOrCreateActiveCart(customerId);
    const idx = cart.items.findIndex((i) => i.bookId.toString() === bookId);
    if (idx >= 0) cart.items[idx].qty = qty;
    else cart.items.push({ bookId: new Types.ObjectId(bookId), qty });
    await cart.save();

    return res.status(200).json({ success: true, data: cart });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateCartItem = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const bookId = req.params.bookId as string;
    if (!mongoose.Types.ObjectId.isValid(bookId))
      return res.status(400).json({ success: false, message: "Invalid book id." });

    const { qty } = updateCartItemSchema.parse(req.body);

    const cart = await BookCart.findOne({ customerId, status: true });
    if (!cart) return res.status(404).json({ success: false, message: "Cart not found." });

    const idx = cart.items.findIndex((i) => i.bookId.toString() === bookId);
    if (idx < 0)
      return res.status(404).json({ success: false, message: "Item not in cart." });
    cart.items[idx].qty = qty;
    await cart.save();

    return res.status(200).json({ success: true, data: cart });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const removeCartItem = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const bookId = req.params.bookId as string;
    if (!mongoose.Types.ObjectId.isValid(bookId))
      return res.status(400).json({ success: false, message: "Invalid book id." });

    const cart = await BookCart.findOne({ customerId, status: true });
    if (!cart) return res.status(404).json({ success: false, message: "Cart not found." });

    cart.items = cart.items.filter((i) => i.bookId.toString() !== bookId);
    await cart.save();

    return res.status(200).json({ success: true, data: cart });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const clearCart = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });
    await BookCart.updateMany({ customerId, status: true }, { $set: { status: false } });
    return res.status(200).json({ success: true, message: "Cart cleared." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Shipping ─────────────────────────────────────────────────────────────────

export const attachShipping = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const data = attachShippingSchema.parse(req.body);
    if (!mongoose.Types.ObjectId.isValid(data.stateId))
      return res.status(400).json({ success: false, message: "Invalid stateId." });

    const shipping = await CustomerShipping.findOneAndUpdate(
      {
        customerId,
        name: data.name,
        phone: data.phone,
        address: data.address,
        pincode: data.pincode,
      },
      { $set: { ...data, customerId, status: true } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const cart = await getOrCreateActiveCart(customerId);
    cart.shippingId = shipping._id;
    await cart.save();

    return res.status(200).json({ success: true, data: { shipping, cart } });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Place Order ──────────────────────────────────────────────────────────────

export const placeOrder = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const { paymentMethod } = placeOrderSchema.parse(req.body);

    const cart = await BookCart.findOne({ customerId, status: true });
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ success: false, message: "Cart is empty." });
    }
    if (!cart.shippingId) {
      return res.status(400).json({
        success: false,
        message: "Shipping address is required before placing order.",
      });
    }

    const bookIds = cart.items.map((i) => i.bookId);
    const books = await Book.find({ _id: { $in: bookIds }, status: true });
    if (books.length !== bookIds.length) {
      return res.status(400).json({
        success: false,
        message: "One or more books in the cart are unavailable.",
      });
    }

    const freeShippingMin = await getFreeShippingMin();
    const { totals } = computeCartTotals(
      cart.items,
      books.map((b) => b.toObject()) as any,
      freeShippingMin
    );

    const bookMap = new Map(books.map((b) => [b._id.toString(), b]));
    const orderItems = cart.items.map((i) => {
      const b = bookMap.get(i.bookId.toString())!;
      return {
        bookId: b._id,
        name: b.name,
        qty: i.qty,
        listPrice: b.listPrice,
        price: b.discountedPrice,
        shippingPrice: totals.shippingWaived ? 0 : b.shippingPrice,
        weight: b.weight ?? 0,
        isMagazine: b.isMagazine,
      };
    });

    const receiptId = `books-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    let createdOrder: any;
    await session.withTransaction(async () => {
      const [order] = await BookOrder.create(
        [
          {
            receiptId,
            customerId,
            shippingId: cart.shippingId,
            items: orderItems,
            orderType: "purchase",
            paymentMethod,
            totalListPrice: totals.totalListPrice,
            totalDiscountedPrice: totals.totalDiscountedPrice,
            totalShippingPrice: totals.effectiveShipping,
            amount: totals.finalAmount,
            status:
              paymentMethod === PaymentMethod.FREE && totals.finalAmount === 0
                ? BookOrderStatus.VERIFIED
                : BookOrderStatus.PENDING,
            tracking: { status: "pending", history: [] },
            ...(paymentMethod === PaymentMethod.FREE && totals.finalAmount === 0
              ? { paidAt: new Date() }
              : {}),
          },
        ],
        { session }
      );
      createdOrder = order;

      // If a paid path, keep cart; Razorpay webhook will clear it.
      // For free/zero orders mark cart inactive immediately.
      if (createdOrder.status === BookOrderStatus.VERIFIED) {
        await BookCart.updateOne(
          { _id: cart._id },
          { $set: { status: false } },
          { session }
        );
      }
    });

    return res.status(201).json({ success: true, data: createdOrder });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

// ─── Orders (customer view) ───────────────────────────────────────────────────

export const listMyOrders = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const { status, page = "1", limit = "20" } = req.query as Record<string, string>;
    const filter: any = { customerId };
    if (status && Object.values(BookOrderStatus).includes(status as BookOrderStatus))
      filter.status = status;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      BookOrder.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      BookOrder.countDocuments(filter),
    ]);

    const decorated = data.map((o) => {
      const obj = o.toObject();
      return {
        ...obj,
        trackingUrl: buildTrackingUrl(obj.tracking?.courier, obj.tracking?.trackingId),
      };
    });

    return res.status(200).json({
      success: true,
      data: decorated,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getMyOrderById = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid order id." });

    const order = await BookOrder.findOne({ _id: id, customerId })
      .populate("shippingId")
      .populate("items.bookId", "_id name thumbnail author");
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });

    const obj = order.toObject();
    return res.status(200).json({
      success: true,
      data: {
        ...obj,
        trackingUrl: buildTrackingUrl(obj.tracking?.courier, obj.tracking?.trackingId),
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
