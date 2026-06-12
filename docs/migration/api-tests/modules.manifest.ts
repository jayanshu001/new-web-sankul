/**
 * Single list of migrated modules with API test coverage.
 * Keep in sync with scripts/generate-migrated-modules.ts MIGRATED_REGISTRY.
 */
export const MIGRATED_API_MODULES = [
  {
    key: "app-update",
    testFiles: ["app-update/admin.api.test.ts", "app-update/client.api.test.ts"],
    endpoints: ["GET/PUT admin/cms/app-update", "GET client/upgrade"],
    yarnScript: "migration:api:app-update",
  },
  {
    key: "version",
    testFiles: ["version/admin.api.test.ts", "version/client.api.test.ts"],
    endpoints: ["GET/PUT admin/cms/version", "GET client/version", "GET client/upgrade"],
    yarnScript: "migration:api:version",
  },
  {
    key: "faq",
    testFiles: ["faq/admin.api.test.ts", "faq/client.api.test.ts"],
    endpoints: [
      "GET admin/cms/faq-types",
      "DELETE faq-types (400)",
      "GET/GET:id/POST/PUT/DELETE admin/cms/faqs",
      "GET client/faq-types",
      "GET client/faqs",
    ],
    yarnScript: "migration:api:faq",
  },
  {
    key: "banner-slider",
    testFiles: ["banner-slider/admin.api.test.ts", "banner-slider/client.api.test.ts"],
    endpoints: [
      "GET/GET:id/POST/PUT/DELETE admin/cms/banners",
      "POST admin/cms/banners/reorder",
      "GET client/banners",
      "GET client/banners?key=",
    ],
    yarnScript: "migration:api:banner-slider",
  },
  {
    key: "testimonial",
    testFiles: ["testimonial/admin.api.test.ts", "testimonial/client.api.test.ts"],
    endpoints: [
      "GET/GET:id/POST/PUT/DELETE admin/cms/testimonials",
      "GET client/testimonials",
    ],
    yarnScript: "migration:api:testimonial",
  },
  {
    key: "department",
    testFiles: ["department/admin.api.test.ts", "department/client.api.test.ts"],
    endpoints: [
      "GET/POST/PUT/DELETE admin/departments",
      "GET client/contactus",
    ],
    yarnScript: "migration:api:department",
  },
  {
    key: "terms",
    testFiles: ["terms/admin.api.test.ts", "terms/client.api.test.ts"],
    endpoints: [
      "GET/GET:id/POST/PUT/DELETE admin/cms/terms",
      "GET client/terms (array)",
      "GET client/terms?module= (single|null)",
    ],
    yarnScript: "migration:api:terms",
  },
  {
    key: "popup",
    testFiles: ["popup/admin.api.test.ts", "popup/client.api.test.ts"],
    endpoints: [
      "GET/GET:id/POST/PUT/DELETE admin/cms/popups",
      "GET client/popup (active: status + promoExpireAt>now, newest)",
    ],
    yarnScript: "migration:api:popup",
  },
  {
    key: "customer-auth",
    testFiles: ["customer-auth/client.api.test.ts"],
    endpoints: [
      "POST client/auth/otp/generate",
      "POST client/auth/otp/validate (token + refreshToken + profile)",
      "POST client/auth/token/refresh (rotation)",
      "DELETE client/auth/logout",
    ],
    yarnScript: "migration:api:customer-auth",
  },
  {
    key: "customer-lookups",
    testFiles: ["customer-lookups/client.api.test.ts"],
    endpoints: [
      "GET client/address/states (+ ?search)",
      "GET client/address/educations",
      "GET client/address/characteristic (educations + goals)",
    ],
    yarnScript: "migration:api:customer-lookups",
  },
  {
    key: "offline-city",
    testFiles: ["offline-city/client.api.test.ts"],
    endpoints: ["GET client/address/cities (+ ?search) — active, ordered"],
    yarnScript: "migration:api:offline-city",
  },
  {
    // Catalog: 4 keys (catalog-package-type, catalog-package, catalog-course,
    // catalog-video) — ALL flag OFF; tests assert endpoint contract always and
    // MySQL-source specifics only when the relevant flag is enabled.
    key: "catalog",
    testFiles: ["catalog/client.api.test.ts"],
    endpoints: [
      "GET client/packages/types — package types (catalog-package-type)",
      "GET client/courses/categories — subject categories + counts (catalog-course)",
      "(video URL-encryption parity verified via tsx — no standalone HTTP endpoint)",
    ],
    yarnScript: "migration:api:catalog",
  },
  {
    // Catalog · eBook (catalog-ebook) — WIRED behind isEbookMysql() (flag OFF).
    // GET /client/ebooks + /:id compose ws_ebook + commerce-price (shared price
    // table, ebook plans) + commerce-ebook-sub (entitlement). No separate
    // ebook-price table/module. Verified via tsx.
    key: "catalog-ebook",
    testFiles: ["catalog-ebook/client.api.test.ts"],
    endpoints: [
      "GET client/ebooks — listing (ws_ebook + plans + purchase state)",
      "GET client/ebooks/:id — detail",
    ],
    yarnScript: "migration:api:catalog-ebook",
  },
  {
    // Catalog · Material (catalog-material) — WIRED behind isMaterialMysql()
    // (flag OFF), category NAVIGATION only. GET /material-categories/:id/children
    // = ws_material_category (children via SQL parent self-FK) + ws_material
    // (per-child count). Item listing stays blocked (entitlement + LiveCourse +
    // Mongo embeds). Verified via tsx.
    key: "catalog-material",
    testFiles: ["catalog-material/client.api.test.ts"],
    endpoints: [
      "GET client/material-categories/:id/children — category navigation (parent → children + counts)",
    ],
    yarnScript: "migration:api:catalog-material",
  },
  {
    // Catalog · Exam (catalog-exam) — WIRED behind isExamMysql() (flag OFF),
    // category NAVIGATION only (mirrors catalog-material). GET
    // /exam-categories/:id/children = ws_exam_category (children via SQL
    // parent_id self-FK, active=status&&!deleted) + ws_exam (UNCONDITIONAL count).
    // Item/attempt surface not migrated. Verified via tsx.
    key: "catalog-exam",
    testFiles: ["catalog-exam/client.api.test.ts"],
    endpoints: [
      "GET client/exam-categories/:id/children — category navigation (parent → children + counts)",
    ],
    yarnScript: "migration:api:catalog-exam",
  },
  {
    // Catalog · Book (catalog-book) — flag OFF, NOT wired (like catalog-package).
    // Book DATA reads over ws_book; listBooks/getBookDetail enrich with cart qty
    // + isPurchased from unmigrated ws_book_order/cart (int-vs-ObjectId), so it
    // flips with the book-order/cart wave. Verified via tsx.
    key: "catalog-book",
    testFiles: ["catalog-book/client.api.test.ts"],
    endpoints: [
      "(no wired HTTP endpoint — book DATA reads verified via tsx; flips with the book-order/cart wave)",
    ],
    yarnScript: "migration:api:catalog-book",
  },
  {
    // Offline · Center/Batch (offline-batch) — WIRED behind isOfflineBatchMysql()
    // (flag OFF), browse reads. GET /client/offline/{centers,batches}(/:id) from
    // ws_offline_center + ws_offline_batch (+ city). PUBLIC routes. Schema fixes:
    // phone Int→BigInt (overflow), removed phantom status. Dashboard stays Mongo
    // (OfflineBannerSlider); enquiry is a write path. Verified via tsx.
    key: "offline-batch",
    testFiles: ["offline-batch/client.api.test.ts"],
    endpoints: [
      "GET client/offline/centers (+ ?cityId/?search)",
      "GET client/offline/batches (+ ?centerId/?cityId/?upcoming/?search)",
      "GET client/offline/centers/:id · GET client/offline/batches/:id",
    ],
    yarnScript: "migration:api:offline-batch",
  },
  {
    // Commerce 3a · Price (commerce-price) — flag OFF, read-only lookup over
    // ws_package_course_ebook_price (1353). No standalone wired HTTP endpoint
    // (every consumer joins int catalog + ObjectId subscription/order rows), so
    // the data path is proven via tsx; the HTTP suite records that + a
    // flag-gated placeholder. Flips with the commerce wave alongside catalog.
    key: "commerce-price",
    testFiles: ["commerce-price/client.api.test.ts"],
    endpoints: [
      "(no standalone HTTP endpoint — plan/pricing lookup verified via tsx; flips with catalog + 3a)",
    ],
    yarnScript: "migration:api:commerce-price",
  },
  {
    // Commerce 3a · Subscription READ (commerce-subscription) — flag OFF,
    // read-only entitlement source of truth over ws_package_course_subscription
    // (2). No standalone HTTP endpoint (rows gate other consumers' access; joined
    // on int catalog + int customer ids). Verified via tsx incl. the bigint
    // `tracking` schema fix. Writes are 3b. Flips with catalog + 3a.
    key: "commerce-subscription",
    testFiles: ["commerce-subscription/client.api.test.ts"],
    endpoints: [
      "(no standalone HTTP endpoint — READ entitlement checks verified via tsx; writes are 3b; flips with catalog + 3a)",
    ],
    yarnScript: "migration:api:commerce-subscription",
  },
  {
    // Commerce 3a · eBook Subscription READ (commerce-ebook-sub) — flag OFF,
    // read-only ebook entitlement over ws_ebook_subscription (1). No standalone
    // HTTP endpoint (rows gate ebook read/download access). Verified via tsx
    // incl. the Prisma status/payment_type additions. Writes are 3b. Flips with
    // catalog + 3a.
    key: "commerce-ebook-sub",
    testFiles: ["commerce-ebook-sub/client.api.test.ts"],
    endpoints: [
      "(no standalone HTTP endpoint — READ ebook entitlement checks verified via tsx; writes are 3b; flips with catalog + 3a)",
    ],
    yarnScript: "migration:api:commerce-ebook-sub",
  },
  {
    // Commerce 3a · Promoter READ (commerce-promoter) — flag OFF, read-only
    // promocode owner master over ws_promoter (114). No standalone HTTP endpoint
    // (ids hydrate promocode owners). `password` never surfaced. Verified via tsx.
    key: "commerce-promoter",
    testFiles: ["commerce-promoter/client.api.test.ts"],
    endpoints: [
      "(no standalone HTTP endpoint — READ owner master verified via tsx; flips with catalog + 3a)",
    ],
    yarnScript: "migration:api:commerce-promoter",
  },
  {
    // Commerce 3a · Promocode READ (commerce-promocode) — flag OFF, SQL-faithful
    // over ws_promocode (2) + ws_promoted_package_course_ebook (5). The SQL
    // tables do NOT carry the Mongo appliesTo/discountValue model the client
    // applyPromocode reads → CANNOT serve that contract this wave; appliesTo
    // reconciliation is a later effort. Verified via tsx.
    key: "commerce-promocode",
    testFiles: ["commerce-promocode/client.api.test.ts"],
    endpoints: [
      "(no standalone HTTP endpoint — SQL-faithful reads verified via tsx; NOT the client appliesTo contract; flips with catalog + 3a)",
    ],
    yarnScript: "migration:api:commerce-promocode",
  },
  {
    // Commerce 3a · Educator READ (commerce-educator) — flag OFF, read-only full
    // entity master over ws_course_educator (56). The FINAL 3a read module. No
    // standalone HTTP endpoint of its own (served via the Mongo educator
    // controller; ids embed in course listings). `password` never surfaced;
    // bigint-unsigned id mapped Int (latent risk logged). Verified via tsx.
    key: "commerce-educator",
    testFiles: ["commerce-educator/client.api.test.ts"],
    endpoints: [
      "(no standalone HTTP endpoint — READ master + {_id,name,image} ref verified via tsx; flips with catalog + 3a)",
    ],
    yarnScript: "migration:api:commerce-educator",
  },
] as const;
