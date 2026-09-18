import { prisma } from "../../config/prisma";
import type {
  SuggestedProductCreateInput,
  SuggestedProductListQuery,
  SuggestedProductUpdateInput,
} from "./suggested-product.types";

export const suggestedProductRepository = {
  findPage: (q: SuggestedProductListQuery) =>
    prisma.jobSuggestedProduct.findMany({
      where: q.placementType ? { placementType: q.placementType } : undefined,
      orderBy: [{ sortOrder: "asc" }, { id: "desc" }],
      skip: q.skip,
      take: q.take,
    }),

  count: (placementType?: SuggestedProductListQuery["placementType"]) =>
    prisma.jobSuggestedProduct.count({ where: placementType ? { placementType } : undefined }),

  findById: (id: bigint) => prisma.jobSuggestedProduct.findUnique({ where: { id } }),

  create: (input: SuggestedProductCreateInput) =>
    prisma.jobSuggestedProduct.create({
      data: {
        placementType: input.placementType,
        postId: input.postId ?? undefined,
        productType: input.productType,
        productId: input.productId,
        sortOrder: input.sortOrder ?? 0,
        isActive: input.isActive ?? true,
      },
    }),

  update: (id: bigint, input: SuggestedProductUpdateInput) =>
    prisma.jobSuggestedProduct.update({
      where: { id },
      data: {
        ...(input.placementType !== undefined ? { placementType: input.placementType } : {}),
        ...(input.postId !== undefined ? { postId: input.postId } : {}),
        ...(input.productType !== undefined ? { productType: input.productType } : {}),
        ...(input.productId !== undefined ? { productId: input.productId } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    }),

  delete: (id: bigint) => prisma.jobSuggestedProduct.delete({ where: { id } }),
};
