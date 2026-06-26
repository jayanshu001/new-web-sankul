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

// Recent search history (declared before "/" so the literal path resolves
// cleanly). All require a Bearer token.
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
