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

router.get("/", listEbooks);
router.get("/subscriptions", listMySubscriptions);
router.get("/orders/:orderId/invoice", getEbookOrderInvoice);

// Downloads — must be registered BEFORE the /:id catch-all so the literal
// "/downloads" segment isn't swallowed as an ebook id.
router.get("/downloads", listEbookDownloads);
router.delete("/downloads/:ebookId", removeEbookDownload);
router.post("/:id/download", recordEbookDownload);

router.get("/:id", getEbookDetail);

export default router;
