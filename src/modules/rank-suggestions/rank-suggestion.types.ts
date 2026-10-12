export const SUGGESTION_KINDS = ["product", "link"] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

/** `package` covers every package type (smart, planner, …); `course` is a single course. */
export const SUGGESTION_PRODUCT_TYPES = ["package", "course", "live_course", "book", "ebook"] as const;
export type SuggestionProductType = (typeof SUGGESTION_PRODUCT_TYPES)[number];

export interface RankSuggestionDto {
  _id: string;
  exam_id: string;
  kind: SuggestionKind;
  /** Set for a product, null for a link. */
  product_type: SuggestionProductType | null;
  product_id: string | null;
  /** Set for a link, null for a product. */
  url: string | null;
  /** A link's heading. A product's comes from the catalog, so this is null. */
  title: string | null;
  /** A link's cover image. A product's comes from the catalog, so this is null. */
  image: string | null;
  /** Optional line shown with the suggestion, e.g. "You are ready for Mains". */
  description: string | null;
  /** A link's button text; null falls back to the client's default. */
  cta_label: string | null;
  /** Inclusive lower bound on raw marks; null = no lower bound. */
  min_marks: number | null;
  /** Exclusive upper bound on raw marks; null = no upper bound. */
  max_marks: number | null;
  sort_order: number;
  is_active: boolean;
}

export interface RankSuggestionInput {
  kind: SuggestionKind;
  productType?: SuggestionProductType | null;
  productId?: bigint | null;
  url?: string | null;
  title?: string | null;
  image?: string | null;
  description?: string | null;
  ctaLabel?: string | null;
  minMarks?: number | null;
  maxMarks?: number | null;
  sortOrder?: number;
  isActive?: boolean;
}

/** What the student's own result page asks for. */
export interface MyRankSuggestionsDto {
  /** The raw marks matched against; null until the caller has a scored sheet. */
  score: number | null;
  suggestions: RankSuggestionDto[];
}
