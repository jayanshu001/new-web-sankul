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
] as const;
