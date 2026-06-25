import mongoose from "mongoose";
import { FAQ } from "../../models/system/FAQ.model";
import { FaqType } from "../../models/system/FaqType.model";
import { isMysqlModule } from "../../config/migration";
import { buildSearchFilter } from "../../utils/searchFilter";
import { faqRepository } from "./faq.repository";
import { toFaqDto, toFaqTypeDto } from "./faq.transformer";
import type {
  FaqCategory,
  FaqCreateInput,
  FaqCreateMongoInput,
  FaqDto,
  FaqTypeDto,
  FaqUpdateInput,
  FaqUpdateMongoInput,
} from "./faq.types";
import { FAQ_TYPES } from "./faq.types";

const MODULE = "faq";

export const parseFaqId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const resolveCategoryFilter = (
  typeId?: string
): FaqCategory | undefined => {
  if (!typeId) return undefined;
  if ((FAQ_TYPES as readonly string[]).includes(typeId)) {
    return typeId as FaqCategory;
  }
  return undefined;
};

// ─── FAQ CRUD ────────────────────────────────────────────────────────────────

export const listFaqs = async (opts?: {
  typeId?: string;
}): Promise<FaqDto[]> => {
  if (isMysqlModule(MODULE)) {
    const type = resolveCategoryFilter(opts?.typeId);
    const rows = await faqRepository.findMany(type ? { type } : undefined);
    return rows.map(toFaqDto);
  }

  const filter: Record<string, unknown> = {};
  if (opts?.typeId && mongoose.Types.ObjectId.isValid(opts.typeId)) {
    filter.typeId = opts.typeId;
  }
  const docs = await FAQ.find(filter)
    .populate("typeId", "_id title")
    .sort({ createdAt: 1 })
    .lean();
  return docs.map((d) => ({
    _id: String(d._id),
    typeId: d.typeId as unknown as FaqTypeDto | string,
    question: d.question,
    answer: d.answer,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  }));
};

/**
 * Admin server-side search + sort + opt-in pagination. `skip`/`take` apply only
 * when provided (absent → full filtered list). Always returns the total count.
 */
export const listFaqsPaged = async (q: {
  typeId?: string;
  search?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  skip?: number;
  take?: number;
}): Promise<{ items: FaqDto[]; total: number }> => {
  if (isMysqlModule(MODULE)) {
    const type = resolveCategoryFilter(q.typeId);
    const opts = { type, search: q.search, sortBy: q.sortBy, sortDir: q.sortDir, skip: q.skip, take: q.take };
    const [rows, total] = await Promise.all([
      faqRepository.findPage(opts),
      faqRepository.count(opts),
    ]);
    return { items: rows.map(toFaqDto), total };
  }

  const filter: Record<string, unknown> = {};
  if (q.typeId && mongoose.Types.ObjectId.isValid(q.typeId)) filter.typeId = q.typeId;
  Object.assign(filter, buildSearchFilter(q.search, ["question", "answer"]));
  const sortField = q.sortBy === "question" ? "question" : q.sortBy === "updatedAt" ? "updatedAt" : "createdAt";
  // No explicit sort → newest first; explicit sortBy without dir → asc (e.g. question A-Z).
  const sortNum = q.sortDir === "asc" ? 1 : q.sortDir === "desc" ? -1 : q.sortBy ? 1 : -1;
  let query = FAQ.find(filter).populate("typeId", "_id title").sort({ [sortField]: sortNum, _id: -1 });
  if (q.skip != null) query = query.skip(q.skip);
  if (q.take != null) query = query.limit(q.take);
  const [docs, total] = await Promise.all([query.lean(), FAQ.countDocuments(filter)]);
  return {
    items: docs.map((d) => ({
      _id: String(d._id),
      typeId: d.typeId as unknown as FaqTypeDto | string,
      question: d.question,
      answer: d.answer,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    })),
    total,
  };
};

export const getFaqById = async (id: string): Promise<FaqDto | null> => {
  if (isMysqlModule(MODULE)) {
    const numId = parseFaqId(id);
    if (!numId) return null;
    const row = await faqRepository.findById(numId);
    return row ? toFaqDto(row) : null;
  }

  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await FAQ.findById(id).populate("typeId", "_id title").lean();
  if (!doc) return null;
  return {
    _id: String(doc._id),
    typeId: doc.typeId as unknown as FaqTypeDto | string,
    question: doc.question,
    answer: doc.answer,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};

export const createFaq = async (
  input: FaqCreateInput | FaqCreateMongoInput
): Promise<FaqDto> => {
  if (isMysqlModule(MODULE)) {
    const row = await faqRepository.create(input as FaqCreateInput);
    return toFaqDto(row);
  }

  const mongoInput = input as FaqCreateMongoInput;
  const doc = await FAQ.create({
    typeId: mongoInput.typeId,
    question: mongoInput.question,
    answer: mongoInput.answer,
  });
  const lean = await FAQ.findById(doc._id).populate("typeId", "_id title").lean();
  return {
    _id: String(lean!._id),
    typeId: lean!.typeId as unknown as FaqTypeDto | string,
    question: lean!.question,
    answer: lean!.answer,
    createdAt: lean!.createdAt,
    updatedAt: lean!.updatedAt,
  };
};

export const updateFaq = async (
  id: string,
  input: FaqUpdateInput | FaqUpdateMongoInput
): Promise<FaqDto | null> => {
  if (isMysqlModule(MODULE)) {
    const numId = parseFaqId(id);
    if (!numId) return null;
    try {
      const row = await faqRepository.update(numId, input as FaqUpdateInput);
      return toFaqDto(row);
    } catch {
      return null;
    }
  }

  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const mongoInput = input as FaqUpdateMongoInput;
  const payload: Record<string, unknown> = { ...mongoInput };
  const doc = await FAQ.findByIdAndUpdate(
    id,
    { $set: payload },
    { new: true }
  )
    .populate("typeId", "_id title")
    .lean();
  if (!doc) return null;
  return {
    _id: String(doc._id),
    typeId: doc.typeId as unknown as FaqTypeDto | string,
    question: doc.question,
    answer: doc.answer,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};

export const deleteFaq = async (id: string): Promise<boolean> => {
  if (isMysqlModule(MODULE)) {
    const numId = parseFaqId(id);
    if (!numId) return false;
    try {
      await faqRepository.delete(numId);
      return true;
    } catch {
      return false;
    }
  }

  if (!mongoose.Types.ObjectId.isValid(id)) return false;
  const doc = await FAQ.findByIdAndDelete(id);
  return !!doc;
};

export const countFaqsByCategory = async (
  type: FaqCategory
): Promise<number> => {
  if (isMysqlModule(MODULE)) {
    return faqRepository.countByType(type);
  }
  return 0;
};

export const isFaqTypeInUse = async (typeIdOrCategory: string): Promise<boolean> => {
  if (
    isMysqlModule(MODULE) &&
    (FAQ_TYPES as readonly string[]).includes(typeIdOrCategory)
  ) {
    return (await countFaqsByCategory(typeIdOrCategory as FaqCategory)) > 0;
  }
  if (!mongoose.Types.ObjectId.isValid(typeIdOrCategory)) return false;
  return !!(await FAQ.exists({ typeId: typeIdOrCategory }));
};

// ─── FAQ types (Mongo collection; synthetic list on MySQL) ───────────────────

export const listFaqTypes = async (): Promise<FaqTypeDto[]> => {
  if (isMysqlModule(MODULE)) {
    return FAQ_TYPES.map((t) => ({
      ...toFaqTypeDto(t),
      createdAt: undefined,
      updatedAt: undefined,
    }));
  }

  const docs = await FaqType.find().sort({ title: 1 }).lean();
  return docs.map((d) => ({
    _id: String(d._id),
    title: d.title,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  }));
};
