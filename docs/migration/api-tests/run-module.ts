/**
 * Run HTTP API tests for one migrated module.
 *
 *   yarn migration:api:faq
 *   tsx docs/migration/api-tests/run-module.ts app-update
 */
import { MIGRATED_API_MODULES } from "./modules.manifest.js";
import { runAppUpdateApiTests } from "./app-update/admin.api.test.js";
import { runAppUpdateClientApiTests } from "./app-update/client.api.test.js";
import { runVersionAdminApiTests } from "./version/admin.api.test.js";
import { runVersionClientApiTests } from "./version/client.api.test.js";
import { runFaqAdminApiTests } from "./faq/admin.api.test.js";
import { runFaqClientApiTests } from "./faq/client.api.test.js";
import { runBannerSliderAdminApiTests } from "./banner-slider/admin.api.test.js";
import { runBannerSliderClientApiTests } from "./banner-slider/client.api.test.js";
import { runTestimonialAdminApiTests } from "./testimonial/admin.api.test.js";
import { runTestimonialClientApiTests } from "./testimonial/client.api.test.js";
import { runDepartmentAdminApiTests } from "./department/admin.api.test.js";
import { runDepartmentClientApiTests } from "./department/client.api.test.js";
import { runTermsAdminApiTests } from "./terms/admin.api.test.js";
import { runTermsClientApiTests } from "./terms/client.api.test.js";
import { runPopupAdminApiTests } from "./popup/admin.api.test.js";
import { runPopupClientApiTests } from "./popup/client.api.test.js";
import { runCustomerAuthClientApiTests } from "./customer-auth/client.api.test.js";
import { runCustomerLookupsClientApiTests } from "./customer-lookups/client.api.test.js";
import { runOfflineCityClientApiTests } from "./offline-city/client.api.test.js";
import { runCatalogClientApiTests } from "./catalog/client.api.test.js";
import { runCatalogEbookClientApiTests } from "./catalog-ebook/client.api.test.js";
import { runCatalogMaterialClientApiTests } from "./catalog-material/client.api.test.js";
import { runCatalogExamClientApiTests } from "./catalog-exam/client.api.test.js";
import { runCatalogBookClientApiTests } from "./catalog-book/client.api.test.js";
import { runOfflineBatchClientApiTests } from "./offline-batch/client.api.test.js";
import { runCommercePriceClientApiTests } from "./commerce-price/client.api.test.js";
import { runCommerceSubscriptionClientApiTests } from "./commerce-subscription/client.api.test.js";
import { runCommerceEbookSubClientApiTests } from "./commerce-ebook-sub/client.api.test.js";
import { runCommercePromoterClientApiTests } from "./commerce-promoter/client.api.test.js";
import { runCommercePromocodeClientApiTests } from "./commerce-promocode/client.api.test.js";
import { runCommerceEducatorClientApiTests } from "./commerce-educator/client.api.test.js";

const moduleKey = process.argv[2]?.trim().toLowerCase();

const runners: Record<string, (() => Promise<boolean>)[]> = {
  "app-update": [runAppUpdateApiTests, runAppUpdateClientApiTests],
  version: [runVersionAdminApiTests, runVersionClientApiTests],
  faq: [runFaqAdminApiTests, runFaqClientApiTests],
  "banner-slider": [runBannerSliderAdminApiTests, runBannerSliderClientApiTests],
  testimonial: [runTestimonialAdminApiTests, runTestimonialClientApiTests],
  department: [runDepartmentAdminApiTests, runDepartmentClientApiTests],
  terms: [runTermsAdminApiTests, runTermsClientApiTests],
  popup: [runPopupAdminApiTests, runPopupClientApiTests],
  "customer-auth": [runCustomerAuthClientApiTests],
  "customer-lookups": [runCustomerLookupsClientApiTests],
  "offline-city": [runOfflineCityClientApiTests],
  catalog: [runCatalogClientApiTests],
  "catalog-ebook": [runCatalogEbookClientApiTests],
  "catalog-material": [runCatalogMaterialClientApiTests],
  "catalog-exam": [runCatalogExamClientApiTests],
  "catalog-book": [runCatalogBookClientApiTests],
  "offline-batch": [runOfflineBatchClientApiTests],
  "commerce-price": [runCommercePriceClientApiTests],
  "commerce-subscription": [runCommerceSubscriptionClientApiTests],
  "commerce-ebook-sub": [runCommerceEbookSubClientApiTests],
  "commerce-promoter": [runCommercePromoterClientApiTests],
  "commerce-promocode": [runCommercePromocodeClientApiTests],
  "commerce-educator": [runCommerceEducatorClientApiTests],
};

async function main() {
  if (!moduleKey || !runners[moduleKey]) {
    console.error("Usage: tsx docs/migration/api-tests/run-module.ts <module>");
    console.error("Modules:", Object.keys(runners).join(", "));
    process.exit(1);
  }

  let ok = true;
  for (const run of runners[moduleKey]) {
    if (!(await run())) ok = false;
  }

  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
