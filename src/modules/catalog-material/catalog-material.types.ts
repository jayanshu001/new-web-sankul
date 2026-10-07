// Material categories: DTO types.
export interface MaterialCategoryDto {
  _id: string;
  title: string;
  slug: string;
  image: string | null;
  /** Self-FK parent id (0 = root). */
  parent: number;
  order: number;
  status: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface MaterialCategoryChildDto extends MaterialCategoryDto {
  count: number;
  /** True when at least one active category has `parent = this.id`. */
  havingChildDirectory: boolean;
}

export interface MaterialCategoryChildrenResult {
  parent: MaterialCategoryDto;
  list: Array<{ category: MaterialCategoryChildDto }>;
  total: number;
}
