import { Router, Request, Response, NextFunction } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3 } from "../../middlewares/upload";
import { cacheRoute } from "../../middlewares/cacheRoute";
import { autoFlushGroup } from "../../middlewares/autoFlush";
import {
  listFaqs, getFaq, createFaq, updateFaq, deleteFaq,
  listFaqTypes, getFaqType, createFaqType, updateFaqType, deleteFaqType,
  listPopups, getPopup, createPopup, updatePopup, deletePopup,
  listBanners, getBanner, createBanner, updateBanner, deleteBanner, reorderBanners,
  listLiveBanners, getLiveBanner, createLiveBanner, updateLiveBanner, deleteLiveBanner, reorderLiveBanners,
  listTestimonials, getTestimonial, createTestimonial, updateTestimonial, deleteTestimonial,
  listSocialLinkTypes, getSocialLinkType, createSocialLinkType, updateSocialLinkType, deleteSocialLinkType,
  listSocialLinks, getSocialLink, createSocialLink, updateSocialLink, deleteSocialLink,
  listTerms, getTerms, createTerms, updateTerms, deleteTerms,
  listCurrentAffairs, getCurrentAffair, createCurrentAffair, updateCurrentAffair, deleteCurrentAffair,
  getVersion, upsertVersion,
  getAppUpdate, upsertAppUpdate,
} from "./cms.controller";

const router = Router();

const attachImage = (req: Request, _res: Response, next: NextFunction) => {
  const file = req.file as any;
  if (file?.location) req.body.image = file.location;
  next();
};

const coercePopup = (req: Request, _res: Response, next: NextFunction) => {
  if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
  next();
};

const coerceBanner = (req: Request, _res: Response, next: NextFunction) => {
  if (typeof req.body.orderBy === "string") req.body.orderBy = Number(req.body.orderBy);
  next();
};

const attachIcon = (req: Request, _res: Response, next: NextFunction) => {
  const file = req.file as any;
  if (file?.location) req.body.icon = file.location;
  next();
};

const coerceSocialLink = (req: Request, _res: Response, next: NextFunction) => {
  if (typeof req.body.order === "string") req.body.order = Number(req.body.order);
  if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
  next();
};

const coerceCurrentAffair = (req: Request, _res: Response, next: NextFunction) => {
  if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
  next();
};

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

// Route-level response cache + autoFlushGroup on writes (see docs/CACHING.md).
// Each CMS surface tags its own entity; the flush groups also clear the client
// "cms" cache (+ dashboard for banner/testimonial). Version/app-update singletons
// are trivial and left uncached.

// FAQ
router.get("/faqs", cacheRoute({ ttl: 86400, entity: "faq" }), listFaqs);
router.post("/faqs", autoFlushGroup("faq"), createFaq);
router.get("/faqs/:id", cacheRoute({ ttl: 86400, entity: "faq" }), getFaq);
router.put("/faqs/:id", autoFlushGroup("faq"), updateFaq);
router.delete("/faqs/:id", autoFlushGroup("faq"), deleteFaq);

// FAQ Types
router.get("/faq-types", cacheRoute({ ttl: 86400, entity: "faq" }), listFaqTypes);
router.post("/faq-types", autoFlushGroup("faq"), createFaqType);
router.get("/faq-types/:id", getFaqType);
router.put("/faq-types/:id", autoFlushGroup("faq"), updateFaqType);
router.delete("/faq-types/:id", autoFlushGroup("faq"), deleteFaqType);

// Popup
router.get("/popups", cacheRoute({ ttl: 86400, entity: "popup" }), listPopups);
router.post("/popups", uploadS3.single("image"), attachImage, coercePopup, autoFlushGroup("popup"), createPopup);
router.get("/popups/:id", cacheRoute({ ttl: 86400, entity: "popup" }), getPopup);
router.put("/popups/:id", uploadS3.single("image"), attachImage, coercePopup, autoFlushGroup("popup"), updatePopup);
router.delete("/popups/:id", autoFlushGroup("popup"), deletePopup);

// Banner
router.get("/banners", cacheRoute({ ttl: 86400, entity: "banner" }), listBanners);
router.post("/banners", uploadS3.single("image"), attachImage, coerceBanner, autoFlushGroup("banner"), createBanner);
router.post("/banners/reorder", autoFlushGroup("banner"), reorderBanners);
router.get("/banners/:id", cacheRoute({ ttl: 86400, entity: "banner" }), getBanner);
router.put("/banners/:id", uploadS3.single("image"), attachImage, coerceBanner, autoFlushGroup("banner"), updateBanner);
router.delete("/banners/:id", autoFlushGroup("banner"), deleteBanner);

// Live Banner — same flow as Banner, but `key` is implicit (always LiveCourse).
router.get("/live-banners", cacheRoute({ ttl: 86400, entity: "banner" }), listLiveBanners);
router.post("/live-banners", uploadS3.single("image"), attachImage, coerceBanner, autoFlushGroup("banner"), createLiveBanner);
router.post("/live-banners/reorder", autoFlushGroup("banner"), reorderLiveBanners);
router.get("/live-banners/:id", cacheRoute({ ttl: 86400, entity: "banner" }), getLiveBanner);
router.put("/live-banners/:id", uploadS3.single("image"), attachImage, coerceBanner, autoFlushGroup("banner"), updateLiveBanner);
router.delete("/live-banners/:id", autoFlushGroup("banner"), deleteLiveBanner);

// Testimonials
router.get("/testimonials", cacheRoute({ ttl: 86400, entity: "testimonial" }), listTestimonials);
router.post("/testimonials", autoFlushGroup("testimonial"), createTestimonial);
router.get("/testimonials/:id", cacheRoute({ ttl: 86400, entity: "testimonial" }), getTestimonial);
router.put("/testimonials/:id", autoFlushGroup("testimonial"), updateTestimonial);
router.delete("/testimonials/:id", autoFlushGroup("testimonial"), deleteTestimonial);

// Social Link Types
router.get("/social-link-types", cacheRoute({ ttl: 86400, entity: "social-link" }), listSocialLinkTypes);
router.post("/social-link-types", autoFlushGroup("social-link"), createSocialLinkType);
router.get("/social-link-types/:id", getSocialLinkType);
router.put("/social-link-types/:id", autoFlushGroup("social-link"), updateSocialLinkType);
router.delete("/social-link-types/:id", autoFlushGroup("social-link"), deleteSocialLinkType);

// Social Links
router.get("/social-links", cacheRoute({ ttl: 86400, entity: "social-link" }), listSocialLinks);
router.post("/social-links", uploadS3.single("icon"), attachIcon, coerceSocialLink, autoFlushGroup("social-link"), createSocialLink);
router.get("/social-links/:id", cacheRoute({ ttl: 86400, entity: "social-link" }), getSocialLink);
router.put("/social-links/:id", uploadS3.single("icon"), attachIcon, coerceSocialLink, autoFlushGroup("social-link"), updateSocialLink);
router.delete("/social-links/:id", autoFlushGroup("social-link"), deleteSocialLink);

// Current Affairs — image optional on PUT; when absent, attachImage adds
// nothing and genericUpdate's $set keeps the existing image URL.
router.get("/current-affairs", cacheRoute({ ttl: 86400, entity: "current-affair" }), listCurrentAffairs);
router.post("/current-affairs", uploadS3.single("image"), attachImage, coerceCurrentAffair, autoFlushGroup("current-affair"), createCurrentAffair);
router.get("/current-affairs/:id", cacheRoute({ ttl: 86400, entity: "current-affair" }), getCurrentAffair);
router.put("/current-affairs/:id", uploadS3.single("image"), attachImage, coerceCurrentAffair, autoFlushGroup("current-affair"), updateCurrentAffair);
router.delete("/current-affairs/:id", autoFlushGroup("current-affair"), deleteCurrentAffair);

// Terms
router.get("/terms", cacheRoute({ ttl: 86400, entity: "terms" }), listTerms);
router.post("/terms", autoFlushGroup("terms"), createTerms);
router.get("/terms/:id", cacheRoute({ ttl: 86400, entity: "terms" }), getTerms);
router.put("/terms/:id", autoFlushGroup("terms"), updateTerms);
router.delete("/terms/:id", autoFlushGroup("terms"), deleteTerms);

// Version (singleton)
router.get("/version", getVersion);
router.put("/version", upsertVersion);

// AppUpdate (singleton)
router.get("/app-update", getAppUpdate);
router.put("/app-update", upsertAppUpdate);

export default router;
