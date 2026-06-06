/**
 * Banner slider — stable API shape (Mongo-compatible for admin / client).
 *
 * Contract bridges two schema differences between Mongo and legacy MySQL:
 *
 *  1. `key` casing:
 *       Mongo enum:  "Packages" | "Courses" | "Book" | "EBook"
 *       MySQL value: "package"  | "course"  | "book" | "ebook"
 *     The transformer maps MySQL → Mongo casing so the API JSON is unchanged.
 *
 *  2. `keyId` population:
 *       Mongo `.populate("keyId")` embeds the referenced Package/Course/... doc.
 *       MySQL `ws_banner_slider.key_id` is a nullable int and the referenced
 *       catalog modules are not migrated yet, so `keyId` is served as `null`
 *       (every row in the staging dump has key_id = NULL).
 */

export const BANNER_KEYS = ["Packages", "Courses", "Book", "EBook", "Explore"] as const;
export type BannerKey = (typeof BANNER_KEYS)[number];

/**
 * Mongo `keyRef` (model name) derived from `key`.
 * `Explore` is a standalone CTA banner with no linked collection — it is
 * intentionally absent so keyRef/keyId stay unset for it (matches the Mongo model).
 */
export const BANNER_KEY_TO_MODEL: Partial<Record<BannerKey, string>> = {
  Packages: "Package",
  Courses: "Course",
  Book: "Book",
  EBook: "Ebook",
};

/** MySQL lowercase `ws_banner_slider.key` → Mongo-cased enum. */
export const MYSQL_KEY_TO_BANNER_KEY: Record<string, BannerKey> = {
  package: "Packages",
  packages: "Packages",
  course: "Courses",
  courses: "Courses",
  book: "Book",
  ebook: "EBook",
  explore: "Explore",
};

/** Mongo-cased enum → MySQL lowercase column value (for writes). */
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
  /** Populated reference doc when available; null when served from MySQL. */
  keyId: unknown | null;
  keyRef?: string;
  orderBy: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface BannerCreateInput {
  image: string;
  key?: BannerKey;
  keyId?: string;
  orderBy?: number;
}

export interface BannerUpdateInput {
  image?: string;
  key?: BannerKey;
  keyId?: string;
  orderBy?: number;
}

export interface BannerReorderInput {
  orders: { id: string; orderBy: number }[];
}
