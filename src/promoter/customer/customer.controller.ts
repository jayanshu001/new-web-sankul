import { Request, Response } from "express";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { EbookSubscription } from "../../models/ebook/EbookSubscription.model";
import { Customer } from "../../models/customer/Customer.model";

// GET /api/v1/promoter/customers — unique customers attributed to this promoter
export const listMyCustomers = async (req: Request, res: Response) => {
  try {
    const promoterId = req.user?.id;
    if (!promoterId) return res.status(401).json({ success: false, message: "Unauthorized." });

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
    if (search) {
      filter.$or = [
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
        { phoneNumber: { $regex: search, $options: "i" } },
        { emailAddress: { $regex: search, $options: "i" } },
      ];
    }

    const [data, total] = await Promise.all([
      Customer.find(filter)
        .select("firstName lastName phoneNumber emailAddress city gender createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Customer.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/promoter/customers/:id
export const getMyCustomerDetail = async (req: Request, res: Response) => {
  try {
    const promoterId = req.user?.id;
    if (!promoterId) return res.status(401).json({ success: false, message: "Unauthorized." });
    const customerId = req.params.id as string;

    // Ensure this customer is actually attributed to this promoter
    const hasSub = await PackageCourseSubscription.exists({ customerId, promoterId });
    const hasEbook = await EbookSubscription.exists({ customerId, promoterId });
    if (!hasSub && !hasEbook)
      return res.status(404).json({ success: false, message: "Customer not found." });

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

    return res.status(200).json({
      success: true,
      data: { customer, courseSubscriptions: courseSubs, ebookSubscriptions: ebookSubs },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
