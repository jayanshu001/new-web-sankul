import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { updateProfileHandler, getProfileHandler } from "./customer.controller";

const router = Router();

/**
 * @route  PUT /api/v1/customer/profile
 * @desc   Update customer profile details
 * @access Private (Customer)
 */
router.put("/update", authenticate, updateProfileHandler);

/**
 * @route  GET /api/v1/client/profile/me
 * @desc   Get full customer profile data natively mapped to UI state
 */
router.get("/", authenticate, getProfileHandler);
export default router;
