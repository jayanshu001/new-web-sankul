// Exam categories: DTO and input types.
/**
 * Active exam category = `status = true AND deleted = false`; children are
 * `WHERE parent_id = id`.
 */

export interface ExamCategoryDto {
  _id: string;
  /** Same value as `name`. */
  title: string | null;
  name: string | null;
  image: string | null;
  parent: number;
  order: number;
  status: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface ExamCategoryChildDto extends ExamCategoryDto {
  /** Counts every exam in the category regardless of status. */
  count: number;
  havingChildDirectory: boolean;
}

export interface ExamCategoryChildrenResult {
  parent: ExamCategoryDto;
  list: Array<{ category: ExamCategoryChildDto }>;
  total: number;
}
