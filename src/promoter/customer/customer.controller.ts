import { Request, Response } from "express";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { EbookSubscription } from "../../models/ebook/EbookSubscription.model";
import { Customer } from "../../models/customer/Customer.model";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { buildSearchFilter } from "../../utils/searchFilter";

// GET /api/v1/promoter/customers — unique customers attributed to this promoter
export const listMyCustomers = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const promoterId = req.user?.id;
  logger.info("listMyCustomers invoked", { traceId, path: req.originalUrl, promoterId });

  try {
    if (!promoterId) { logger.warn("listMyCustomers unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const { search, page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const [courseCustomerIds, ebookCustomerIds] = await Promise.all([
      PackageCourseSubscription.distinct("customerId", { promoterId }),
      EbookSubscription.distinct("customerId", { promoterId }),
    ]);

    const customerIdsSet = new Set<string>();
    [...courseCustomerIds, ...ebookCustomerIds].forEach((id: any) => customerIdsSet.add(String(id)));
    const customerIds = Array.from(customerIdsSet);

    const filter: any = { _id: { $in: customerIds }, isAccountDeleted: false };
    Object.assign(filter, buildSearchFilter(search, ["firstName", "lastName", "phoneNumber", "emailAddress"]));

    const [data, total] = await Promise.all([
      Customer.find(filter)
        .select("firstName lastName phoneNumber emailAddress city gender createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Customer.countDocuments(filter),
    ]);

    logger.info("listMyCustomers success", { traceId, promoterId, total, returned: data.length });
    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (e: any) {
    logger.error("listMyCustomers failed", { traceId, promoterId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/promoter/customers/:id
export const getMyCustomerDetail = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const promoterId = req.user?.id;
  const customerId = req.params.id as string;
  logger.info("getMyCustomerDetail invoked", { traceId, path: req.originalUrl, promoterId, customerId });

  try {
    if (!promoterId) { logger.warn("getMyCustomerDetail unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    // Ensure this customer is actually attributed to this promoter
    const hasSub = await PackageCourseSubscription.exists({ customerId, promoterId });
    const hasEbook = await EbookSubscription.exists({ customerId, promoterId });
    if (!hasSub && !hasEbook) { logger.warn("getMyCustomerDetail not attributed", { traceId, promoterId, customerId }); return res.status(404).json({ success: false, message: "Customer not found." }); }

    const [customer, courseSubs, ebookSubs] = await Promise.all([
      Customer.findById(customerId)
        .select("firstName lastName phoneNumber emailAddress city gender createdAt")
        .lean(),
      PackageCourseSubscription.find({ customerId, promoterId })
        .populate({ path: "courseId", select: "name" })
        .sort({ createdAt: -1 })
        .lean(),
      EbookSubscription.find({ customerId, promoterId })
        .populate({ path: "ebookId", select: "name author" })
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    logger.info("getMyCustomerDetail success", { traceId, promoterId, customerId, courseSubs: courseSubs.length, ebookSubs: ebookSubs.length });
    return res.status(200).json({
      success: true,
      data: { customer, courseSubscriptions: courseSubs, ebookSubscriptions: ebookSubs },
    });
  } catch (e: any) {
    logger.error("getMyCustomerDetail failed", { traceId, promoterId, customerId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
