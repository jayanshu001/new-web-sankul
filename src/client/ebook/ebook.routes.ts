import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import {
  listEbooks,
  listMySubscriptions,
  getEbookDetail,
  getEbookOrderInvoice,
} from "./ebook.controller";
import {
  recordEbookDownload,
  listEbookDownloads,
  removeEbookDownload,
} from "./ebook-downloads.controller";

const router = Router();

router.use(authenticate);

// listEbooks / getEbookDetail cache internally now (catalog-ebook.service.ts
// uses cache.aside — shared data cached, isPurchased/daysLeft/demoMediaToken/
// bookMediaToken always live). Don't wrap these in an outer
// cacheRoute({ scope: CacheScope.User }) — see course.routes.ts for why.
router.get("/", listEbooks);

// Tier-3 (wholly per-user) — NOT cached: my subscriptions / my invoice.
router.get("/subscriptions", listMySubscriptions);
router.get("/orders/:orderId/invoice", getEbookOrderInvoice);

// Downloads — must be registered BEFORE the /:id catch-all so the literal
// "/downloads" segment isn't swallowed as an ebook id. Tier-3 per-user list, not
// cached; the download writes below touch only the user's download rows (which no
// cached list/detail response embeds), so no autoFlushGroup is needed here.
router.get("/downloads", listEbookDownloads);
router.delete("/downloads/:ebookId", removeEbookDownload);
router.post("/:id/download", recordEbookDownload);

router.get("/:id", getEbookDetail);

export default router;
