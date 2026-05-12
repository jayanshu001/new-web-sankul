import mongoose from "mongoose";
import { Customer } from "../../models/customer/Customer.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";

export interface AudienceFilter {
  platforms?: ("ios" | "android")[];
  courseIds?: string[];
  userIds?: string[];
}

export interface ResolvedAudience {
  isAll: boolean;
  customerIds: mongoose.Types.ObjectId[];
}

const toObjectId = (v: string) => new mongoose.Types.ObjectId(v);

export async function resolveAudience(filter: AudienceFilter): Promise<ResolvedAudience> {
  const hasPlatforms = !!filter.platforms?.length;
  const hasCourses = !!filter.courseIds?.length;
  const hasUsers = !!filter.userIds?.length;

  if (!hasPlatforms && !hasCourses && !hasUsers) {
    return { isAll: true, customerIds: [] };
  }

  const query: Record<string, unknown> = {
    isAccountDeleted: false,
    status: true,
    "firebaseTokens.0": { $exists: true },
  };

  if (hasPlatforms) {
    query.osType = { $in: filter.platforms };
  }

  if (hasUsers) {
    query._id = { $in: filter.userIds!.map(toObjectId) };
  }

  if (hasCourses) {
    const now = new Date();
    const enrolled = await PackageCourseSubscription.distinct("customerId", {
      courseId: { $in: filter.courseIds!.map(toObjectId) },
      paymentStatus: "verified",
      status: true,
      $or: [{ endAt: null }, { endAt: { $gt: now } }],
    });
    if (enrolled.length === 0) {
      return { isAll: false, customerIds: [] };
    }
    if (query._id && typeof query._id === "object" && "$in" in (query._id as any)) {
      const userIdSet = new Set(
        (query._id as { $in: mongoose.Types.ObjectId[] }).$in.map((id) => id.toString())
      );
      const intersected = enrolled.filter((id: any) => userIdSet.has(id.toString()));
      query._id = { $in: intersected };
    } else {
      query._id = { $in: enrolled };
    }
  }

  const customers = await Customer.find(query).select("_id").lean();
  return {
    isAll: false,
    customerIds: customers.map((c: any) => c._id),
  };
}
