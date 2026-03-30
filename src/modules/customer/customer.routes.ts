import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { updateProfileHandler } from "./customer.controller";

const router = Router();

/**
 * @route  PUT /api/v1/customer/profile
 * @desc   Update customer profile details
 * @access Private (Customer)
 */
router.put("/profile", authenticate, updateProfileHandler);

export default router;
