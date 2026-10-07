// Client ebooks: catalog, subscription, invoice and download routes.
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

// listEbooks / getEbookDetail cache internally (shared data cached; isPurchased/daysLeft/
// media tokens always live). Don't wrap them in cacheRoute({ scope: CacheScope.User });
// see course.routes.ts for why.
router.get("/", listEbooks);

// Per-user, not cached.
router.get("/subscriptions", listMySubscriptions);
router.get("/orders/:orderId/invoice", getEbookOrderInvoice);

// Must be registered before the /:id catch-all. Per-user and not cached; download writes
// touch only rows no cached response embeds, so no autoFlushGroup is needed.
router.get("/downloads", listEbookDownloads);
router.delete("/downloads/:ebookId", removeEbookDownload);
router.post("/:id/download", recordEbookDownload);

router.get("/:id", getEbookDetail);

export default router;
