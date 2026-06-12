import { prisma } from "../../config/prisma";

/**
 * Prisma persistence for the commerce · educator READ branch
 * (`ws_course_educator`, Phase 3a — READ-ONLY, flag OFF).
 *
 * Read-only master. "Active" educator = `status = true` (the SQL table has no
 * `deleted` flag — the Mongo soft-delete has no SQL counterpart, so `status` is
 * the sole visibility gate). Reads never select `password` — the transformer
 * excludes it; Prisma `select` is used for the lightweight ref projection.
 */
export const commerceEducatorRepository = {
  /** Single educator by id. */
  findById: (id: number) =>
    prisma.courseEducator.findUnique({ where: { id } }),

  /** Single ACTIVE educator by id (mirrors `findOne({_id, status:true})`). */
  findActiveById: (id: number) =>
    prisma.courseEducator.findFirst({ where: { id, status: true } }),

  /** Educators by ids (bulk hydration of course `courseEducatorId`). */
  findByIds: (ids: number[]) =>
    ids.length
      ? prisma.courseEducator.findMany({
          where: { id: { in: ids } },
          orderBy: { id: "asc" },
        })
      : Promise.resolve([]),

  /** Active educators, ordered by name then id. Optional name search. */
  listActive: (opts?: { search?: string }) =>
    prisma.courseEducator.findMany({
      where: {
        status: true,
        ...(opts?.search ? { name: { contains: opts.search } } : {}),
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),

  /**
   * Lightweight ref projection ({id, name, image}) for embedding in course
   * listings — mirrors `.populate("courseEducatorId", "_id name image")`.
   */
  findRefById: (id: number) =>
    prisma.courseEducator.findUnique({
      where: { id },
      select: { id: true, name: true, image: true },
    }),
};
