/**
 * Banner slider: DTO, input types and key mappings (frozen; live clients parse it).
 *
 * - `key`: the API uses "Packages" | "Courses" | "Book" | "EBook" while the DB stores
 *   "package" | "course" | "book" | "ebook"; the transformer maps between them.
 * - `keyId`: the scalar `ws_banner_slider.key_id` deep-link target, not a populated
 *   doc. `key`/`keyRef` already name the collection, and populating would cost a
 *   lookup across four tables per banner on a hot cached route. Required for the
 *   four collection keys; always null for `Explore` (a standalone CTA).
 */

export const BANNER_KEYS = ["Packages", "Courses", "Book", "EBook", "Explore"] as const;
export type BannerKey = (typeof BANNER_KEYS)[number];

/**
 * `keyRef` (model name) derived from `key`. `Explore` is intentionally absent: it
 * has no linked collection, so keyRef/keyId stay unset.
 */
export const BANNER_KEY_TO_MODEL: Partial<Record<BannerKey, string>> = {
  Packages: "Package",
  Courses: "Course",
  Book: "Book",
  EBook: "Ebook",
};

/**
 * A key points at a catalog row (and therefore needs `keyId`) exactly when it
 * has a `keyRef` model. Derived from BANNER_KEY_TO_MODEL so the validation and
 * the transformer can never disagree about which keys require a target.
 */
export const bannerKeyNeedsTarget = (key: BannerKey): boolean =>
  BANNER_KEY_TO_MODEL[key] !== undefined;

/** DB lowercase `ws_banner_slider.key` → API enum. */
export const MYSQL_KEY_TO_BANNER_KEY: Record<string, BannerKey> = {
  package: "Packages",
  packages: "Packages",
  course: "Courses",
  courses: "Courses",
  book: "Book",
  ebook: "EBook",
  explore: "Explore",
};

/** API enum → DB column value (for writes). */
export const BANNER_KEY_TO_MYSQL: Record<BannerKey, string> = {
  Packages: "package",
  Courses: "course",
  Book: "book",
  EBook: "ebook",
  Explore: "explore",
};

export interface BannerSliderDto {
  _id: string;
  image: string;
  key?: BannerKey;
  /** Deep-link target id in the `keyRef` collection; null for Explore / unset. */
  keyId: number | null;
  keyRef?: string;
  orderBy: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface BannerCreateInput {
  image: string;
  key?: BannerKey;
  keyId?: string | number;
  orderBy?: number;
}

export interface BannerUpdateInput {
  image?: string;
  key?: BannerKey;
  keyId?: string | number;
  orderBy?: number;
}
