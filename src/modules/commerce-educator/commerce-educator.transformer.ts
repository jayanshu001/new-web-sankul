import type { CourseEducator } from "@prisma/client";
import type { EducatorDto, EducatorRefDto } from "./commerce-educator.types";

/**
 * `ws_course_educator` row → DTO, shape-compatible with the Mongo
 * `CourseEducator` document. `password` is DELIBERATELY excluded — the client
 * educator path does `.select("-password")` and it must never reach a response.
 */
export const toEducatorDto = (row: CourseEducator): EducatorDto => ({
  _id: String(row.id),
  name: row.name,
  image: row.image ?? null,
  about: row.about,
  email: row.email,
  view: row.view,
  status: row.status,
  createdAt: row.createdAt ?? null,
  updatedAt: row.updatedAt ?? null,
});

/** Lightweight `{_id, name, image}` ref → DTO (course-listing embed). */
export const toEducatorRefDto = (
  row: { id: number; name: string; image: string | null }
): EducatorRefDto => ({
  _id: String(row.id),
  name: row.name,
  image: row.image ?? null,
});
