import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute } from "../../middlewares/cacheRoute";
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

// Route-level response cache (see docs/CACHING.md).
// List + detail are Tier-2 (shared ebook/plan content + a per-user `isPurchased`
// overlay), so they use scope:"user" + a short TTL — one copy per customer that
// refreshes fast, exactly like /client/dashboard. `isPurchased` flips on purchase
// (a write in the payment flow) and is bounded stale only for the TTL window.
// entity:"catalog-ebook" ties these into the flush map: admin ebook writes call
// autoFlushGroup("ebook") → clears "catalog-ebook", so edits show up immediately.
router.get("/", cacheRoute({ ttl: 86400, entity: "catalog-ebook", scope: "user" }), listEbooks);

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

router.get("/:id", cacheRoute({ ttl: 86400, entity: "catalog-ebook", scope: "user" }), getEbookDetail);

export default router;
