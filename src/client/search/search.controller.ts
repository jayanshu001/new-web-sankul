import { Request, Response } from "express";
import { Model } from "mongoose";
import { Course } from "../../models/course/Course.model";
import { Package } from "../../models/course/Package.model";
import { Book } from "../../models/book/Book.model";
import { Ebook } from "../../models/ebook/Ebook.model";

const TYPE_TO_MODEL: Record<string, Model<any>> = {
  courses: Course,
  packages: Package,
  books: Book,
  ebooks: Ebook,
};

// Escape user input so a query like "C++" or "(2024)" doesn't blow up the regex.
function escapeRegex(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// GET /api/v1/client/search?q=&type=courses|packages|books|ebooks&page=&limit=
export const globalSearch = async (req: Request, res: Response) => {
  try {
    const { q, type } = req.query as Record<string, string>;
    const page = Math.max(parseInt(req.query.page as string, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 10, 1), 50);

    const filter = {
      status: true,
      name: { $regex: escapeRegex((q || "").trim()), $options: "i" },
    };
    const skip = (page - 1) * limit;

    if (!type || !TYPE_TO_MODEL[type]) {
      const entries = Object.entries(TYPE_TO_MODEL);
      const results = await Promise.all(
        entries.map(async ([key, M]) => {
          const [items, total] = await Promise.all([
            M.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
            M.countDocuments(filter),
          ]);
          return [key, { items, total, hasMore: skip + items.length < total }] as const;
        })
      );

      const data = Object.fromEntries(results);
      const grandTotal = results.reduce((sum, [, v]) => sum + v.total, 0);

      return res.status(200).json({
        success: true,
        data: {
          type: "all",
          page,
          limit,
          total: grandTotal,
          results: data,
        },
      });
    }

    const Model = TYPE_TO_MODEL[type];

    const [items, total] = await Promise.all([
      Model.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Model.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        type,
        items,
        total,
        page,
        limit,
        hasMore: skip + items.length < total,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
