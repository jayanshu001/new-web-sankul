/**
 * Run all migration HTTP API tests (migrated modules only).
 *
 *   yarn migration:api
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
import { runCommerceOrderClientApiTests } from "./commerce-order/client.api.test.js";
import { runEbookOrderClientApiTests } from "./ebook-order/client.api.test.js";
import { runBookOrderClientApiTests } from "./book-order/client.api.test.js";
import { runOfflineEnquiryClientApiTests } from "./offline-enquiry/client.api.test.js";
import { runPackageChatClientApiTests } from "./package-chat/client.api.test.js";

async function main() {
  console.log("Migrated modules:", MIGRATED_API_MODULES.map((m) => m.key).join(", "));

  const suites = [
    runAppUpdateApiTests,
    runAppUpdateClientApiTests,
    runVersionAdminApiTests,
    runVersionClientApiTests,
    runFaqAdminApiTests,
    runFaqClientApiTests,
    runBannerSliderAdminApiTests,
    runBannerSliderClientApiTests,
    runTestimonialAdminApiTests,
    runTestimonialClientApiTests,
    runDepartmentAdminApiTests,
    runDepartmentClientApiTests,
    runTermsAdminApiTests,
    runTermsClientApiTests,
    runPopupAdminApiTests,
    runPopupClientApiTests,
    runCustomerAuthClientApiTests,
    runCustomerLookupsClientApiTests,
    runOfflineCityClientApiTests,
    runCatalogClientApiTests,
    runCatalogEbookClientApiTests,
    runCatalogMaterialClientApiTests,
    runCatalogExamClientApiTests,
    runCatalogBookClientApiTests,
    runOfflineBatchClientApiTests,
    runCommercePriceClientApiTests,
    runCommerceSubscriptionClientApiTests,
    runCommerceEbookSubClientApiTests,
    runCommercePromoterClientApiTests,
    runCommercePromocodeClientApiTests,
    runCommerceEducatorClientApiTests,
    runCommerceOrderClientApiTests,
    runEbookOrderClientApiTests,
    runBookOrderClientApiTests,
    runOfflineEnquiryClientApiTests,
    runPackageChatClientApiTests,
  ];

  let ok = true;
  for (const run of suites) {
    if (!(await run())) ok = false;
  }

  console.log(ok ? "\nAll migration API test suites passed." : "\nSome migration API tests failed.");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
