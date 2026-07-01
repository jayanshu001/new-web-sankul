import type { RefferalTerm, RefferalFaq } from "@prisma/client";
import { prisma } from "../../config/prisma";

export const REFERRAL_CONTENT_MODULE = "referral-content";

export const isReferralContentMysql = (): boolean => true;

export const parseRcId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export interface TermDto {
  _id: string;
  text: string;
  order: number;
  status: boolean;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

export interface FaqDto {
  _id: string;
  question: string;
  answer: string;
  order: number;
  status: boolean;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

export interface TermInput {
  text?: string;
  order?: number;
  status?: boolean;
}

export interface FaqInput {
  question?: string;
  answer?: string;
  order?: number;
  status?: boolean;
}

const toTermDto = (r: RefferalTerm): TermDto => ({
  _id: String(r.id),
  text: r.text,
  order: r.orderBy,
  status: r.status,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const toFaqDto = (r: RefferalFaq): FaqDto => ({
  _id: String(r.id),
  question: r.question,
  answer: r.answer,
  order: r.orderBy,
  status: r.status,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

// ─── Client read helpers ───────────────────────────────────────────────────
// Slim, status-filtered projections matching the legacy client contract
// (`/client/referral/terms` -> {_id,text,order}; `/faqs` -> {_id,question,answer,order}).

export const listActiveTermsForClient = async (): Promise<
  { _id: string; text: string; order: number }[]
> => {
  const rows = await prisma.refferalTerm.findMany({
    where: { status: true },
    orderBy: [{ orderBy: "asc" }, { createdAt: "asc" }],
    select: { id: true, text: true, orderBy: true },
  });
  return rows.map((r) => ({ _id: String(r.id), text: r.text, order: r.orderBy }));
};

export const listActiveFaqsForClient = async (): Promise<
  { _id: string; question: string; answer: string; order: number }[]
> => {
  const rows = await prisma.refferalFaq.findMany({
    where: { status: true },
    orderBy: [{ orderBy: "asc" }, { createdAt: "asc" }],
    select: { id: true, question: true, answer: true, orderBy: true },
  });
  return rows.map((r) => ({
    _id: String(r.id),
    question: r.question,
    answer: r.answer,
    order: r.orderBy,
  }));
};

// ─── List options (admin search + sort + opt-in pagination) ──────────────────
export interface RcListOpts {
  search?: string;
  sortBy?: string; // order | createdAt | updatedAt
  sortDir?: "asc" | "desc";
  skip?: number;
  take?: number;
}
const rcOrderBy = (opts: RcListOpts): any[] => {
  const dir = opts.sortDir ?? "asc";
  switch (opts.sortBy) {
    case "order": return [{ orderBy: dir }, { id: "desc" }];
    case "createdAt": return [{ createdAt: dir }, { id: "desc" }];
    case "updatedAt": return [{ updatedAt: dir }, { id: "desc" }];
    // Default: recently-added on top (newest id first).
    default: return [{ createdAt: "desc" }, { id: "desc" }];
  }
};

// ─── Terms ───────────────────────────────────────────────────────────────────

export const listTerms = async (opts: RcListOpts = {}): Promise<{ data: TermDto[]; total: number }> => {
  const where: any = {};
  if (opts.search?.trim()) where.text = { contains: opts.search.trim() };
  const [rows, total] = await Promise.all([
    prisma.refferalTerm.findMany({
      where,
      orderBy: rcOrderBy(opts),
      ...(opts.skip !== undefined ? { skip: opts.skip } : {}),
      ...(opts.take !== undefined ? { take: opts.take } : {}),
    }),
    prisma.refferalTerm.count({ where }),
  ]);
  return { data: rows.map(toTermDto), total };
};

export const getTerm = async (id: number): Promise<TermDto | null> => {
  const row = await prisma.refferalTerm.findUnique({ where: { id } });
  return row ? toTermDto(row) : null;
};

export const createTerm = async (input: TermInput): Promise<TermDto> => {
  const now = new Date();
  const row = await prisma.refferalTerm.create({
    data: {
      text: input.text ?? "",
      orderBy: input.order ?? 0,
      status: input.status ?? true,
      createdAt: now,
      updatedAt: now,
    },
  });
  return toTermDto(row);
};

export const updateTerm = async (
  id: number,
  input: TermInput
): Promise<TermDto | null> => {
  try {
    const row = await prisma.refferalTerm.update({
      where: { id },
      data: {
        ...(input.text !== undefined ? { text: input.text } : {}),
        ...(input.order !== undefined ? { orderBy: input.order } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        updatedAt: new Date(),
      },
    });
    return toTermDto(row);
  } catch {
    return null;
  }
};

export const deleteTerm = async (id: number): Promise<boolean> => {
  try {
    await prisma.refferalTerm.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
};

// ─── FAQs ────────────────────────────────────────────────────────────────────

export const listFaqs = async (opts: RcListOpts = {}): Promise<{ data: FaqDto[]; total: number }> => {
  const where: any = {};
  if (opts.search?.trim()) {
    const s = opts.search.trim();
    where.OR = [{ question: { contains: s } }, { answer: { contains: s } }];
  }
  const [rows, total] = await Promise.all([
    prisma.refferalFaq.findMany({
      where,
      orderBy: rcOrderBy(opts),
      ...(opts.skip !== undefined ? { skip: opts.skip } : {}),
      ...(opts.take !== undefined ? { take: opts.take } : {}),
    }),
    prisma.refferalFaq.count({ where }),
  ]);
  return { data: rows.map(toFaqDto), total };
};

export const getFaq = async (id: number): Promise<FaqDto | null> => {
  const row = await prisma.refferalFaq.findUnique({ where: { id } });
  return row ? toFaqDto(row) : null;
};

export const createFaq = async (input: FaqInput): Promise<FaqDto> => {
  const now = new Date();
  const row = await prisma.refferalFaq.create({
    data: {
      question: input.question ?? "",
      answer: input.answer ?? "",
      orderBy: input.order ?? 0,
      status: input.status ?? true,
      createdAt: now,
      updatedAt: now,
    },
  });
  return toFaqDto(row);
};

export const updateFaq = async (
  id: number,
  input: FaqInput
): Promise<FaqDto | null> => {
  try {
    const row = await prisma.refferalFaq.update({
      where: { id },
      data: {
        ...(input.question !== undefined ? { question: input.question } : {}),
        ...(input.answer !== undefined ? { answer: input.answer } : {}),
        ...(input.order !== undefined ? { orderBy: input.order } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        updatedAt: new Date(),
      },
    });
    return toFaqDto(row);
  } catch {
    return null;
  }
};

export const deleteFaq = async (id: number): Promise<boolean> => {
  try {
    await prisma.refferalFaq.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
};
