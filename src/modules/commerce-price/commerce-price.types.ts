// Commerce prices: plan price DTO type.

/**
 * Exactly one of `packageId` / `courseId` / `ebookId` is set per row (not
 * enforced by the table).
 */
export interface PriceDto {
  _id: string;
  packageId: string | null;
  courseId: string | null;
  ebookId: string | null;
  name: string | null;
  /** In DAYS, not months; compute `endAt` via `utils/planDuration` (`setDate`). */
  duration: number;
  price: number;
  withMaterial: boolean;
  /** Nullable column, coalesced to 0. */
  materialPrice: number;
  isDefault: boolean;
  status: boolean;
  /** Effective flag: computed from sales or admin pin. */
  isMostPopular: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}
