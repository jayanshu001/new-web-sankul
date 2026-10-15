import type { OcrSuggestion } from "@prisma/client";
import type {
  RankSuggestionDto,
  SuggestionKind,
  SuggestionProductType,
} from "./rank-suggestion.types";

const toNullableNumber = (value: OcrSuggestion["minMarks"]): number | null =>
  value === null ? null : Number(value);

export const toRankSuggestionDto = (row: OcrSuggestion): RankSuggestionDto => ({
  _id: String(row.id),
  exam_id: String(row.examId),
  kind: row.kind as SuggestionKind,
  product_type: (row.productType as SuggestionProductType | null) ?? null,
  product_id: row.productId === null ? null : String(row.productId),
  url: row.url,
  title: row.title,
  image: row.image,
  description: row.description,
  cta_label: row.ctaLabel,
  min_marks: toNullableNumber(row.minMarks),
  max_marks: toNullableNumber(row.maxMarks),
  sort_order: row.sortOrder,
  is_active: row.isActive,
});
