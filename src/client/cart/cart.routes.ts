import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import {
  addToCart,
  getCart,
  updateCartItemQty,
  removeCartItem,
  attachShippingToCart,
} from "./cart.controller";

const router = Router();

router.use(authenticate);

router.post("/", addToCart);
router.get("/", getCart);
router.patch("/items/:bookId", updateCartItemQty);
router.delete("/items/:bookId", removeCartItem);
router.post("/shipping", attachShippingToCart);

export default router;
