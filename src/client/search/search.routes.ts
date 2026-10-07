// Client search: global search and search history routes.
import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { validate } from "../../middlewares/validate";
import { globalSearch } from "./search.controller";
import {
  listSearchHistory,
  clearSearchHistory,
  deleteSearchHistory,
} from "./search-history.controller";
import { deleteSearchHistoryParams } from "../../modules/client-search-history/client-search-history.validation";

const router = Router();

// Declared before "/" so the literal path resolves.
router.get("/history", authenticate, listSearchHistory);
router.delete("/history", authenticate, clearSearchHistory);
router.delete(
  "/history/:id",
  authenticate,
  validate({ params: deleteSearchHistoryParams }),
  deleteSearchHistory
);

router.get("/", authenticate, globalSearch);

export default router;
