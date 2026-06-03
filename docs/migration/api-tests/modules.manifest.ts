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
] as const;
