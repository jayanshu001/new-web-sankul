import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import {
  listWishlist,
  addToWishlist,
  removeFromWishlist,
  checkWishlist,
} from "./wishlist.controller";

const router = Router();

router.use(authenticate);

router.get("/", listWishlist);
router.post("/", addToWishlist);
router.get("/check/:itemType/:itemId", checkWishlist);
router.delete("/:itemType/:itemId", removeFromWishlist);

export default router;
