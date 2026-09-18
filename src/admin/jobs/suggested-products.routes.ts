import { Router } from "express";
import {
  getSuggestedProductList,
  getSuggestedProductDetail,
  createSuggestedProduct,
  updateSuggestedProduct,
  deleteSuggestedProduct,
} from "./suggested-products.controller";

const router = Router();

router.get("/", getSuggestedProductList);
router.post("/", createSuggestedProduct);
router.get("/:id", getSuggestedProductDetail);
router.put("/:id", updateSuggestedProduct);
router.delete("/:id", deleteSuggestedProduct);

export default router;
