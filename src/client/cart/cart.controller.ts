import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { BookCart } from "../../models/book/BookCart.model";
import { Book } from "../../models/book/Book.model";
import { CustomerAddress } from "../../models/customer/CustomerAddress.model";
import { CustomerShipping } from "../../models/customer/CustomerShipping.model";
import { Customer } from "../../models/customer/Customer.model";
import { OfflineCity } from "../../models/offline/OfflineCity.model";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

const addSchema = z.object({
  bookId: objectId,
  qty: z.number().int().min(1).max(99).optional().default(1),
});

const updateQtySchema = z.object({
  qty: z.number().int().min(1).max(99),
});

// POST /api/v1/client/cart
// Adds a book to the active cart. If the book is already in the cart, increments qty.
export const addToCart = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const { bookId, qty } = addSchema.parse(req.body);

    const bookExists = await Book.exists({ _id: bookId });
    if (!bookExists) return res.status(404).json({ success: false, message: "Book not found." });

    const bookObjectId = new mongoose.Types.ObjectId(bookId);

    const incremented = await BookCart.findOneAndUpdate(
      { customerId: userId, status: true, "items.bookId": bookObjectId },
      { $inc: { "items.$.qty": qty } },
      { new: true }
    );

    if (incremented) {
      return res.status(200).json({ success: true, data: incremented, message: "Quantity updated." });
    }

    const cart = await BookCart.findOneAndUpdate(
      { customerId: userId, status: true },
      { $push: { items: { bookId: bookObjectId, qty } }, $setOnInsert: { customerId: userId } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    return res.status(201).json({ success: true, data: cart, message: "Added to cart." });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// PATCH /api/v1/client/cart/items/:bookId
// Sets the line's qty to an absolute value (1..99). Use DELETE to remove a line.
export const updateCartItemQty = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const bookId = objectId.parse(req.params.bookId);
    const { qty } = updateQtySchema.parse(req.body);

    const updated = await BookCart.findOneAndUpdate(
      { customerId: userId, status: true, "items.bookId": new mongoose.Types.ObjectId(bookId) },
      { $set: { "items.$.qty": qty } },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ success: false, message: "Item not in cart." });
    }
    return res.status(200).json({ success: true, data: updated, message: "Quantity updated." });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// DELETE /api/v1/client/cart/items/:bookId
// Removes a single line from the active cart.
export const removeCartItem = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const bookId = objectId.parse(req.params.bookId);

    const updated = await BookCart.findOneAndUpdate(
      { customerId: userId, status: true, "items.bookId": new mongoose.Types.ObjectId(bookId) },
      { $pull: { items: { bookId: new mongoose.Types.ObjectId(bookId) } } },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ success: false, message: "Item not in cart." });
    }
    return res.status(200).json({ success: true, data: updated, message: "Removed from cart." });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

const attachShippingSchema = z.object({
  addressId: objectId,
});

// POST /api/v1/client/cart/shipping
// Attaches a saved CustomerAddress to the active cart for delivery.
// Internally we mirror it into a CustomerShipping row (legacy table that
// BookCart.shippingId / BookOrder.shippingId reference) and stamp the
// resulting id onto the cart.
export const attachShippingToCart = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const { addressId } = attachShippingSchema.parse(req.body);

    const address = await CustomerAddress.findOne({
      _id: addressId,
      customerId: userId,
      status: true,
    });
    if (!address) {
      return res.status(404).json({ success: false, message: "Address not found." });
    }

    // The Add Address form does not collect phone/email — those live on the
    // Customer profile. Fall back to the customer record so attach succeeds
    // for the common case where the address only carries delivery-specific info.
    let phone = address.phone;
    let email = address.email;
    if (!phone || !email) {
      const customer = await Customer.findById(userId).select("phoneNumber emailAddress");
      phone = phone || customer?.phoneNumber || "";
      email = email || customer?.emailAddress || "";
    }
    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "No phone number on file. Please update your profile before using this address for delivery.",
      });
    }

    let cityName = "";
    if (address.cityId) {
      const city = await OfflineCity.findById(address.cityId).select("name");
      cityName = city?.name ?? "";
    }
    if (!cityName) {
      return res.status(400).json({
        success: false,
        message: "Address is missing a city. Please update the address before using it for delivery.",
      });
    }

    // Find-or-create the matching CustomerShipping row. We dedupe on the
    // unique tuple (customer, name, phone, address, pincode) so re-attaching
    // the same saved address doesn't keep creating new rows.
    const shipping = await CustomerShipping.findOneAndUpdate(
      {
        customerId: userId,
        name: address.name,
        phone,
        address: address.address,
        pincode: address.pincode,
      },
      {
        $set: {
          customerId: userId,
          name: address.name,
          phone,
          alternatePhone: address.alternatePhone,
          email,
          address: address.address,
          address2: address.address2,
          city: cityName,
          stateId: address.stateId,
          pincode: address.pincode,
          status: true,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const cart = await BookCart.findOneAndUpdate(
      { customerId: userId, status: true },
      { $set: { shippingId: shipping._id }, $setOnInsert: { customerId: userId } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    return res.status(200).json({
      success: true,
      data: { cart, shipping },
      message: "Shipping address attached.",
    });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/cart
// Returns the customer's active cart with each item populated and a total summary.
export const getCart = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const cart = await BookCart.findOne({ customerId: userId, status: true }).lean();

    if (!cart || cart.items.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          _id: cart?._id ?? null,
          items: [],
          summary: { subtotal: 0, listTotal: 0, discount: 0, itemCount: 0, shipping: 0, shippingWaived: true, total: 0 },
        },
      });
    }

    const bookIds = cart.items.map((i) => i.bookId);
    const books = await Book.find({ _id: { $in: bookIds } }).lean();
    const byId: Record<string, any> = {};
    books.forEach((b: any) => (byId[String(b._id)] = b));

    let subtotal = 0;
    let listTotal = 0;
    let itemCount = 0;
    let shipping = 0;

    const items = cart.items
      .map((line) => {
        const book = byId[String(line.bookId)];
        if (!book) return null;
        const lineSubtotal = (book.discountedPrice ?? 0) * line.qty;
        const lineList = (book.listPrice ?? 0) * line.qty;
        subtotal += lineSubtotal;
        listTotal += lineList;
        itemCount += line.qty;
        shipping += book.shippingPrice ?? 0;
        return {
          bookId: line.bookId,
          qty: line.qty,
          book,
          lineSubtotal,
          lineList,
        };
      })
      .filter(Boolean);

    const shippingWaived = shipping === 0;
    const total = shippingWaived ? subtotal : subtotal + shipping;

    return res.status(200).json({
      success: true,
      data: {
        _id: cart._id,
        items,
        summary: {
          subtotal,
          listTotal,
          discount: Math.max(0, listTotal - subtotal),
          itemCount,
          shipping,
          shippingWaived,
          total,
        },
      },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
