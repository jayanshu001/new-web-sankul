import { Request, Response } from "express";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import {
  parsePromoterId,
  listPromoterPromocodes,
  getPromoterPromocode,
} from "../../modules/promoter-data/promoter-data.service";

// GET /api/v1/promoter/promocodes
export const listMyPromocodes = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const promoterId = req.user?.id;
  logger.info("listMyPromocodes invoked", { traceId, path: req.originalUrl, promoterId });

  try {
    if (!promoterId) { logger.warn("listMyPromocodes unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    // SQL-faithful: no appliesTo.
    const pid = parsePromoterId(promoterId);
    if (!pid) return res.status(401).json({ success: false, message: "Unauthorized." });
    const data = await listPromoterPromocodes(pid);
    logger.info("listMyPromocodes success (sql)", { traceId, promoterId, count: data.length });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("listMyPromocodes failed", { traceId, promoterId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/promoter/promocodes/:id
export const getMyPromocode = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const promoterId = req.user?.id;
  const id = req.params.id as string;
  logger.info("getMyPromocode invoked", { traceId, path: req.originalUrl, promoterId, promocodeId: id });

  try {
    if (!promoterId) { logger.warn("getMyPromocode unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const pid = parsePromoterId(promoterId);
    const cid = Number(id);
    if (!pid || !Number.isInteger(cid) || cid <= 0) return res.status(400).json({ success: false, message: "Invalid id." });
    const promocode = await getPromoterPromocode(pid, cid);
    if (!promocode) { logger.warn("getMyPromocode not found (sql)", { traceId, promoterId, promocodeId: id }); return res.status(404).json({ success: false, message: "Promocode not found." }); }
    logger.info("getMyPromocode success (sql)", { traceId, promoterId, promocodeId: id });
    return res.status(200).json({ success: true, data: { promocode } });
  } catch (e: any) {
    logger.error("getMyPromocode failed", { traceId, promoterId, promocodeId: id, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
