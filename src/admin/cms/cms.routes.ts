import { Router, Request, Response, NextFunction } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3 } from "../../middlewares/upload";
import {
  listFaqs, getFaq, createFaq, updateFaq, deleteFaq,
  listPopups, getPopup, createPopup, updatePopup, deletePopup,
  listBanners, getBanner, createBanner, updateBanner, deleteBanner, reorderBanners,
  listTestimonials, getTestimonial, createTestimonial, updateTestimonial, deleteTestimonial,
  listTerms, getTerms, createTerms, updateTerms, deleteTerms,
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
  if (typeof req.body.keyId === "string") req.body.keyId = Number(req.body.keyId);
  if (typeof req.body.orderBy === "string") req.body.orderBy = Number(req.body.orderBy);
  next();
};

router.use(authenticate, requireRole("admin", "super_admin"));

// FAQ
router.get("/faqs", listFaqs);
router.post("/faqs", createFaq);
router.get("/faqs/:id", getFaq);
router.put("/faqs/:id", updateFaq);
router.delete("/faqs/:id", deleteFaq);

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

// Testimonials
router.get("/testimonials", listTestimonials);
router.post("/testimonials", createTestimonial);
router.get("/testimonials/:id", getTestimonial);
router.put("/testimonials/:id", updateTestimonial);
router.delete("/testimonials/:id", deleteTestimonial);

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
