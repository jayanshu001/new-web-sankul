import { Request, Response } from "express";
import mongoose from "mongoose";
import { Book } from "../../models/book/Book.model";
import { BookCart } from "../../models/book/BookCart.model";
import { BookOrder } from "../../models/book/BookOrder.model";
import { Ebook } from "../../models/ebook/Ebook.model";
import { EbookPrice } from "../../models/ebook/EbookPrice.model";
import { BookOrderStatus, BookCourier } from "../../models/enums";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

type TrendingOpts = { type?: string; search?: string; language?: string; limit?: number };

export async function fetchTrendingBookItems(opts: TrendingOpts = {}) {
  const wantFree = opts.type === "free";
  const wantPaid = opts.type === "paid" || !opts.type;
  const limitNum = Math.min(Math.max(opts.limit ?? 20, 1), 100);

  const bookFilter: any = { status: true, isTrending: true };
  const ebookFilter: any = { status: true, isTrending: true };
  if (opts.language) {
    bookFilter.language = opts.language;
    ebookFilter.language = opts.language;
  }
  if (opts.search) {
    const rx = { $regex: opts.search, $options: "i" };
    bookFilter.$or = [{ name: rx }, { author: rx }];
    ebookFilter.$or = [{ name: rx }, { author: rx }];
  }
  if (wantFree) {
    bookFilter.discountedPrice = 0;
  } else if (wantPaid) {
    bookFilter.discountedPrice = { $gt: 0 };
  }

  const [books, ebooks] = await Promise.all([
    Book.find(bookFilter).sort({ orderBy: 1, createdAt: -1 }).lean(),
    Ebook.find(ebookFilter).sort({ order: 1, createdAt: -1 }).lean(),
  ]);

  const ebookIds = ebooks.map((e) => e._id);
  const plans = ebookIds.length
    ? await EbookPrice.find({ ebookId: { $in: ebookIds }, status: true }).sort({ duration: 1 }).lean()
    : [];
  const plansByEbook = new Map<string, any[]>();
  plans.forEach((p) => {
    const key = String(p.ebookId);
    const arr = plansByEbook.get(key) || [];
    arr.push(p);
    plansByEbook.set(key, arr);
  });

  const ebookItems = ebooks
    .map((e) => {
      const ePlans = plansByEbook.get(String(e._id)) || [];
      const minPrice = ePlans.length ? Math.min(...ePlans.map((p) => p.price ?? 0)) : 0;
      const isFree = minPrice === 0;
      if (wantFree && !isFree) return null;
      if (wantPaid && isFree) return null;
      return {
        type: "ebook" as const,
        _id: e._id,
        name: e.name,
        description: e.description,
        author: e.author,
        publisher: e.publisher,
        language: e.language,
        image: e.image,
        thumbnail: e.thumbnail,
        demoUrl: e.demoUrl,
        isTrending: e.isTrending,
        price: minPrice,
        isFree,
        plans: ePlans,
        createdAt: e.createdAt,
      };
    })
    .filter(Boolean) as any[];

  const bookItems = books.map((b) => ({
    type: "book" as const,
    _id: b._id,
    name: b.name,
    description: b.description,
    author: b.author,
    language: b.language,
    image: b.image,
    thumbnail: b.thumbnail,
    demoUrl: b.demoUrl,
    isTrending: b.isTrending,
    isCombo: b.isCombo,
    isMagazine: b.isMagazine,
    listPrice: b.listPrice,
    discountedPrice: b.discountedPrice,
    shippingPrice: b.shippingPrice,
    pages: b.pages ?? 0,
    price: b.discountedPrice,
    isFree: b.discountedPrice === 0,
    createdAt: b.createdAt,
  }));

  const merged = [...bookItems, ...ebookItems]
    .sort((a, b) => new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime())
    .slice(0, limitNum);

  return { type: wantFree ? "free" : "paid", items: merged };
}

// GET /api/v1/client/books/trending?type=paid|free&language=&search=&limit=
export const listTrendingBooks = async (req: Request, res: Response) => {
  try {
    const { type, search, language, limit } = req.query as Record<string, string>;
    const wantFree = type === "free";
    const wantPaid = type === "paid" || !type; // default to paid
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const bookFilter: any = { status: true, isTrending: true };
    const ebookFilter: any = { status: true, isTrending: true };
    if (language) {
      bookFilter.language = language;
      ebookFilter.language = language;
    }
    if (search) {
      const rx = { $regex: search, $options: "i" };
      bookFilter.$or = [{ name: rx }, { author: rx }];
      ebookFilter.$or = [{ name: rx }, { author: rx }];
    }
    if (wantFree) {
      bookFilter.discountedPrice = 0;
    } else if (wantPaid) {
      bookFilter.discountedPrice = { $gt: 0 };
    }

    const [books, ebooks] = await Promise.all([
      Book.find(bookFilter).sort({ orderBy: 1, createdAt: -1 }).lean(),
      Ebook.find(ebookFilter).sort({ order: 1, createdAt: -1 }).lean(),
    ]);

    // Resolve ebook pricing — an ebook is "free" if its lowest active plan price is 0 (or no plans).
    const ebookIds = ebooks.map((e) => e._id);
    const plans = ebookIds.length
      ? await EbookPrice.find({ ebookId: { $in: ebookIds }, status: true })
          .sort({ duration: 1 })
          .lean()
      : [];
    const plansByEbook = new Map<string, any[]>();
    plans.forEach((p) => {
      const key = String(p.ebookId);
      const arr = plansByEbook.get(key) || [];
      arr.push(p);
      plansByEbook.set(key, arr);
    });

    const ebookItems = ebooks
      .map((e) => {
        const ePlans = plansByEbook.get(String(e._id)) || [];
        const minPrice = ePlans.length ? Math.min(...ePlans.map((p) => p.price ?? 0)) : 0;
        const isFree = minPrice === 0;
        if (wantFree && !isFree) return null;
        if (wantPaid && isFree) return null;
        return {
          type: "ebook" as const,
          _id: e._id,
          name: e.name,
          description: e.description,
          author: e.author,
          publisher: e.publisher,
          language: e.language,
          image: e.image,
          thumbnail: e.thumbnail,
          demoUrl: e.demoUrl,
          isTrending: e.isTrending,
          price: minPrice,
          isFree,
          plans: ePlans,
          createdAt: e.createdAt,
        };
      })
      .filter(Boolean) as any[];

    const bookItems = books.map((b) => ({
      type: "book" as const,
      _id: b._id,
      name: b.name,
      description: b.description,
      author: b.author,
      language: b.language,
      image: b.image,
      thumbnail: b.thumbnail,
      demoUrl: b.demoUrl,
      isTrending: b.isTrending,
      isCombo: b.isCombo,
      isMagazine: b.isMagazine,
      listPrice: b.listPrice,
      discountedPrice: b.discountedPrice,
      shippingPrice: b.shippingPrice,
      price: b.discountedPrice,
      isFree: b.discountedPrice === 0,
      createdAt: b.createdAt,
    }));

    const merged = [...bookItems, ...ebookItems]
      .sort((a, b) => new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime())
      .slice(0, limitNum);

    return res.status(200).json({
      success: true,
      data: { type: wantFree ? "free" : "paid", items: merged, total: merged.length },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getBookDetail = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid book id." });
    const book = await Book.findOne({ _id: id, status: true }).lean();
    if (!book) return res.status(404).json({ success: false, message: "Book not found." });
    return res.status(200).json({
      success: true,
      data: {
        ...book,
        pages: book.pages ?? 0,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Shipping has moved to POST /api/v1/client/cart/shipping (src/client/cart/*).
// Place-order has moved to POST /api/v1/client/payment/create-order
// (src/client/payment/payment.controller.ts).

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
