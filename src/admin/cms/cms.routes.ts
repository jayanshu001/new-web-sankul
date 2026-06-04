import { Router, Request, Response, NextFunction } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3 } from "../../middlewares/upload";
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

router.use(authenticate, requireRole("admin", "super_admin"));

// FAQ
router.get("/faqs", listFaqs);
router.post("/faqs", createFaq);
router.get("/faqs/:id", getFaq);
router.put("/faqs/:id", updateFaq);
router.delete("/faqs/:id", deleteFaq);

// FAQ Types
router.get("/faq-types", listFaqTypes);
router.post("/faq-types", createFaqType);
router.get("/faq-types/:id", getFaqType);
router.put("/faq-types/:id", updateFaqType);
router.delete("/faq-types/:id", deleteFaqType);

// Popup
router.get("/popups", listPopups);
router.post("/popups", uploadS3.single("image"), attachImage, coercePopup, createPopup);
router.get("/popups/:id", getPopup);
router.put("/popups/:id", uploadS3.single("image"), attachImage, coercePopup, updatePopup);
router.delete("/popups/:id", deletePopup);

// Banner
router.get("/banners", listBanners);
router.post("/banners", uploadS3.single("image"), attachImage, coerceBanner, createBanner);
router.post("/banners/reorder", reorderBanners);
router.get("/banners/:id", getBanner);
router.put("/banners/:id", uploadS3.single("image"), attachImage, coerceBanner, updateBanner);
router.delete("/banners/:id", deleteBanner);

// Live Banner — same flow as Banner, but `key` is implicit (always LiveCourse).
router.get("/live-banners", listLiveBanners);
router.post("/live-banners", uploadS3.single("image"), attachImage, coerceBanner, createLiveBanner);
router.post("/live-banners/reorder", reorderLiveBanners);
router.get("/live-banners/:id", getLiveBanner);
router.put("/live-banners/:id", uploadS3.single("image"), attachImage, coerceBanner, updateLiveBanner);
router.delete("/live-banners/:id", deleteLiveBanner);

// Testimonials
router.get("/testimonials", listTestimonials);
router.post("/testimonials", createTestimonial);
router.get("/testimonials/:id", getTestimonial);
router.put("/testimonials/:id", updateTestimonial);
router.delete("/testimonials/:id", deleteTestimonial);

// Social Link Types
router.get("/social-link-types", listSocialLinkTypes);
router.post("/social-link-types", createSocialLinkType);
router.get("/social-link-types/:id", getSocialLinkType);
router.put("/social-link-types/:id", updateSocialLinkType);
router.delete("/social-link-types/:id", deleteSocialLinkType);

// Social Links
router.get("/social-links", listSocialLinks);
router.post("/social-links", uploadS3.single("icon"), attachIcon, coerceSocialLink, createSocialLink);
router.get("/social-links/:id", getSocialLink);
router.put("/social-links/:id", uploadS3.single("icon"), attachIcon, coerceSocialLink, updateSocialLink);
router.delete("/social-links/:id", deleteSocialLink);

// Current Affairs — image optional on PUT; when absent, attachImage adds
// nothing and genericUpdate's $set keeps the existing image URL.
router.get("/current-affairs", listCurrentAffairs);
router.post("/current-affairs", uploadS3.single("image"), attachImage, coerceCurrentAffair, createCurrentAffair);
router.get("/current-affairs/:id", getCurrentAffair);
router.put("/current-affairs/:id", uploadS3.single("image"), attachImage, coerceCurrentAffair, updateCurrentAffair);
router.delete("/current-affairs/:id", deleteCurrentAffair);

// Terms
router.get("/terms", listTerms);
router.post("/terms", createTerms);
router.get("/terms/:id", getTerms);
router.put("/terms/:id", updateTerms);
router.delete("/terms/:id", deleteTerms);

// Version (singleton)
router.get("/version", getVersion);
router.put("/version", upsertVersion);

// AppUpdate (singleton)
router.get("/app-update", getAppUpdate);
router.put("/app-update", upsertAppUpdate);

export default router;
