// Route-cache flush groups: cache entity tags and which cached reads each admin write stales.
// When an admin edits X, which cached reads (admin and client) go stale. Lists are
// derived from the actual includes + transformers (see cache/FLUSH_GROUP_MAP.md).
// Verified non-embeds, do not add: packages don't embed ebooks/courses/books, and
// ebook/book responses are flat (category/course/package edits don't stale them).

/**
 * Every cache entity tag. Values are the literal Redis key segment: never change an
 * existing value, or previously cached keys silently stop matching their flush.
 */
export enum CacheEntity {
  Ebook = "ebook",
  Book = "book",
  Course = "course",
  Package = "package",
  LiveCourse = "live-course",
  TestSeries = "test-series",
  Exam = "exam",
  Video = "video",
  Material = "material",
  Goal = "goal",
  Educator = "educator",
  PackageType = "package-type",
  Plan = "plan",
  Price = "price",
  PromoCode = "promo-code",
  ExamCountdown = "exam-countdown",
  VideoCategory = "video-category",
  MaterialCategory = "material-category",
  ExamCategory = "exam-category",
  CourseSubjectCategory = "course-subject-category",
  PackageCategory = "package-category",
  Banner = "banner",
  Testimonial = "testimonial",
  Faq = "faq",
  Popup = "popup",
  Terms = "terms",
  SocialLink = "social-link",
  CurrentAffair = "current-affair",
  Offline = "offline",
  // States, districts, educations and target goals (profile/address forms).
  CustomerLookup = "customer-lookup",
  ImageNotification = "image-notification",
  ContactDepartment = "contact-department",
  CatalogEbook = "catalog-ebook",
  CatalogBook = "catalog-book",
  CatalogCourse = "catalog-course",
  CatalogPackage = "catalog-package",
  CatalogExam = "catalog-exam",
  ClientDashboard = "client-dashboard",
  Categories = "categories",
  Free = "free",
  Cms = "cms",
  Cart = "cart",
  // Deliberately in no flush group: it aggregates revenue across every product, so
  // writes would flush it constantly. Its 2-min TTL staleness is the accepted trade.
  AdminDashboard = "admin-dashboard",
  // Default for `cacheRoute()` without `entity`; not reachable by any entity flush.
  Misc = "misc",
}

/** Tags to clear when an admin writes `x`: `x` itself plus every cache embedding its data. */
export const FLUSH_GROUPS: Partial<Record<CacheEntity, CacheEntity[]>> = {
  [CacheEntity.Ebook]: [CacheEntity.Ebook, CacheEntity.CatalogEbook, CacheEntity.ClientDashboard, CacheEntity.Free, CacheEntity.ExamCountdown],

  // The client cart embeds live book price rows, so book edits stale the cart.
  [CacheEntity.Book]: [CacheEntity.Book, CacheEntity.CatalogBook, CacheEntity.ClientDashboard, CacheEntity.ExamCountdown, CacheEntity.Cart],

  [CacheEntity.Course]: [CacheEntity.Course, CacheEntity.CatalogCourse, CacheEntity.ClientDashboard, CacheEntity.Free, CacheEntity.ExamCountdown, CacheEntity.Categories],

  // package-category: GET /client/package-categories derives `packageCount` from
  // ws_package.package_category_id, so attach/detach/status changes restate counts.
  [CacheEntity.Package]: [
    CacheEntity.Package, CacheEntity.CatalogPackage, CacheEntity.ClientDashboard, CacheEntity.Free,
    CacheEntity.ExamCountdown, CacheEntity.Categories, CacheEntity.PackageCategory,
  ],

  // Live courses carry package_category_id: they are half of `packageCount`, and
  // catalog-package tags /client/package-categories/:id/packages whose `live` tab and
  // `counts` are built from them.
  [CacheEntity.LiveCourse]: [
    CacheEntity.LiveCourse, CacheEntity.CatalogCourse, CacheEntity.ClientDashboard, CacheEntity.Free,
    CacheEntity.Categories, CacheEntity.PackageCategory, CacheEntity.CatalogPackage,
  ],

  // Self-contained (verified: no other cached surface embeds test-series data). The
  // tag covers list, detail and papers, which embed categories, papers and plans, so
  // every test-series write flushes the whole tag.
  [CacheEntity.TestSeries]: [CacheEntity.TestSeries],

  // Also tags GET /client/address/cities/:cityId/centers, a second entry point to
  // the same centre data.
  [CacheEntity.Offline]: [CacheEntity.Offline],

  // Written from both admin/address and admin/customer-master.
  [CacheEntity.CustomerLookup]: [CacheEntity.CustomerLookup],

  [CacheEntity.ImageNotification]: [CacheEntity.ImageNotification],
  [CacheEntity.ContactDepartment]: [CacheEntity.ContactDepartment, CacheEntity.Terms],

  // Categories also carry the admin product tags (course, package): the admin course
  // and package DTOs populate category titles, so a rename would otherwise show the old
  // name for the full TTL. material-category also flushes "material", whose cached
  // client reads render category titles.
  [CacheEntity.VideoCategory]: [
    CacheEntity.VideoCategory, CacheEntity.CatalogPackage, CacheEntity.CatalogCourse,
    CacheEntity.Categories, CacheEntity.Free, CacheEntity.Course, CacheEntity.Package,
  ],
  [CacheEntity.MaterialCategory]: [
    CacheEntity.MaterialCategory, CacheEntity.CatalogPackage, CacheEntity.CatalogCourse, CacheEntity.Categories,
    CacheEntity.Free, CacheEntity.Material, CacheEntity.Course, CacheEntity.Package,
  ],
  [CacheEntity.ExamCategory]: [
    CacheEntity.ExamCategory, CacheEntity.CatalogPackage, CacheEntity.CatalogCourse, CacheEntity.CatalogExam,
    CacheEntity.Categories, CacheEntity.Course, CacheEntity.Package,
  ],
  [CacheEntity.CourseSubjectCategory]: [CacheEntity.CourseSubjectCategory, CacheEntity.CatalogCourse, CacheEntity.ClientDashboard, CacheEntity.Course],
  // No admin "package" tag: the admin package DTO emits `packageCategoryId` as a bare id.
  [CacheEntity.PackageCategory]: [CacheEntity.PackageCategory, CacheEntity.CatalogPackage, CacheEntity.Categories],

  [CacheEntity.PackageType]: [CacheEntity.PackageType, CacheEntity.CatalogPackage, CacheEntity.ClientDashboard],
  [CacheEntity.Goal]: [CacheEntity.Goal, CacheEntity.CatalogPackage, CacheEntity.ClientDashboard, CacheEntity.CustomerLookup],
  [CacheEntity.Educator]: [CacheEntity.Educator, CacheEntity.CatalogCourse],

  // Plans/prices are embedded in every product response, including the cached admin
  // course/ebook details and package list, hence course/package/ebook (also covers
  // Most Popular pins, which flush CacheEntity.Plan).
  [CacheEntity.Plan]: [
    CacheEntity.Plan, CacheEntity.Course, CacheEntity.Package, CacheEntity.Ebook, CacheEntity.CatalogPackage,
    CacheEntity.CatalogCourse, CacheEntity.CatalogEbook, CacheEntity.ClientDashboard, CacheEntity.Free,
  ],
  [CacheEntity.Price]: [
    CacheEntity.Price, CacheEntity.Course, CacheEntity.Package, CacheEntity.Ebook, CacheEntity.CatalogPackage,
    CacheEntity.CatalogCourse, CacheEntity.CatalogEbook, CacheEntity.ClientDashboard, CacheEntity.Free,
  ],
  [CacheEntity.PromoCode]: [CacheEntity.PromoCode, CacheEntity.CatalogPackage],

  [CacheEntity.Exam]: [CacheEntity.Exam, CacheEntity.CatalogExam, CacheEntity.ClientDashboard, CacheEntity.Categories],
  [CacheEntity.ExamCountdown]: [CacheEntity.ExamCountdown, CacheEntity.CatalogCourse, CacheEntity.ClientDashboard],

  // Video also drives `hasVideos` on the cached admin video-category list/get.
  [CacheEntity.Video]: [CacheEntity.Video, CacheEntity.CatalogCourse, CacheEntity.Categories, CacheEntity.Free, CacheEntity.VideoCategory],
  [CacheEntity.Material]: [CacheEntity.Material, CacheEntity.Categories, CacheEntity.CatalogPackage, CacheEntity.CatalogCourse],

  [CacheEntity.Banner]: [CacheEntity.Banner, CacheEntity.Cms, CacheEntity.ClientDashboard],
  [CacheEntity.Testimonial]: [CacheEntity.Testimonial, CacheEntity.Cms, CacheEntity.ClientDashboard],
  [CacheEntity.Faq]: [CacheEntity.Faq, CacheEntity.Cms],
  [CacheEntity.Popup]: [CacheEntity.Popup, CacheEntity.Cms],
  // Client book reads embed the module='book' terms when a book has none of its own.
  [CacheEntity.Terms]: [CacheEntity.Terms, CacheEntity.Cms, CacheEntity.CatalogBook],
  [CacheEntity.SocialLink]: [CacheEntity.SocialLink, CacheEntity.Cms],
  [CacheEntity.CurrentAffair]: [CacheEntity.CurrentAffair, CacheEntity.Cms],
};

/** Unknown group resolves to just itself, so it never throws in a request path. */
export const resolveFlushGroup = (name: CacheEntity): CacheEntity[] =>
  FLUSH_GROUPS[name] ?? [name];
