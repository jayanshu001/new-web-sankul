export const JOB_SUGGESTED_PLACEMENTS = [
  "home",
  "jobs",
  "call_letters",
  "results",
  "answer_keys",
  "syllabus",
  "previous_papers",
  "others",
  "exam_calendar",
] as const;
export type JobSuggestedPlacement = (typeof JOB_SUGGESTED_PLACEMENTS)[number];

export const JOB_PRODUCT_TYPES = ["course", "package", "book", "ebook"] as const;
export type JobProductType = (typeof JOB_PRODUCT_TYPES)[number];

export interface SuggestedProductDto {
  _id: string;
  placementType: JobSuggestedPlacement;
  postId?: string;
  productType: JobProductType;
  productId: string;
  sortOrder: number;
  isActive: boolean;
  createdAt?: Date;
}

export interface SuggestedProductCreateInput {
  placementType: JobSuggestedPlacement;
  postId?: bigint | null;
  productType: JobProductType;
  productId: bigint;
  sortOrder?: number;
  isActive?: boolean;
}

export type SuggestedProductUpdateInput = Partial<SuggestedProductCreateInput>;

export interface SuggestedProductListQuery {
  placementType?: JobSuggestedPlacement;
  skip: number;
  take: number;
}
