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
 *  2. `keyId` — the banner's deep-link target:
 *       Mongo `.populate("keyId")` embedded the referenced Package/Course/...
 *       doc. On MySQL it is served as the scalar `ws_banner_slider.key_id` int:
 *       `key`/`keyRef` already tell the client WHICH collection to open, so the
 *       id alone is enough to deep-link, and populating would cost a per-banner
 *       lookup across four tables on a hot cached route.
 *       Required whenever `key` is one of the four collection keys; always null
 *       for `Explore`, which is a standalone CTA with no target.
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

/**
 * A key points at a catalog row (and therefore needs `keyId`) exactly when it
 * has a `keyRef` model. Derived from BANNER_KEY_TO_MODEL so the validation and
 * the transformer can never disagree about which keys require a target.
 */
export const bannerKeyNeedsTarget = (key: BannerKey): boolean =>
  BANNER_KEY_TO_MODEL[key] !== undefined;

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

export interface BannerReorderInput {
  orders: { id: string; orderBy: number }[];
}
