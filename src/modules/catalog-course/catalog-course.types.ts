// Course catalog: DTO and input types.
export interface CourseSubjectCategoryDto {
  _id: string;
  title: string;
  slug: string;
  image: string;
  parent: number;
  order: number;
  status: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface CourseSubjectCategoryWithCountDto extends CourseSubjectCategoryDto {
  courseCount: number;
}

export interface CourseDto {
  _id: string;
  name: string | null;
  description: string;
  image: string | null;
  shareableLink: string;
  withMaterial: string;
  withoutMaterial: string;
  level: string;
  order: number;
  status: boolean;
  /** From `is_featured`: only "yes" is popular. */
  isPopular: boolean;
  /** From `purchase`: unset means paid, only an explicit "no" is free. */
  isPaid: boolean;
  courseSubjectCategoryId: string | null;
  courseEducatorId: string | null;
  videoCategoryId: string | null;
  pcMaterialId: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface CourseRefDto {
  _id: string;
  name?: string;
  title?: string;
}

export interface CoursePlanBuckets {
  withMaterial: unknown[];
  withoutMaterial: unknown[];
}

export interface CourseListItemDto
  extends Omit<CourseDto, "courseEducatorId" | "courseSubjectCategoryId" | "videoCategoryId"> {
  courseEducatorId: CourseRefDto | string | null;
  courseSubjectCategoryId: CourseRefDto | string | null;
  videoCategoryId: CourseRefDto | string | null;
  isPurchased: boolean;
  daysLeft: number | null;
  plans: CoursePlanBuckets;
}

export interface PaginatedCourses {
  data: CourseListItemDto[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface ListCoursesOptions {
  search?: string;
  isPopular?: boolean;
  page?: number;
  limit?: number;
  sortBy?: "createdAt" | "ordered" | "name";
  sortOrder?: "asc" | "desc";
  /** Resolved int customer id for purchase state. */
  customerId?: number;
  categoryId?: number;
}
