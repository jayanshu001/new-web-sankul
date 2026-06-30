import { Types } from "mongoose";
import { Course } from "../../models/course/Course.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { CustomerAddress } from "../../models/customer/CustomerAddress.model";
import { CustomerShipping } from "../../models/customer/CustomerShipping.model";
import { CustomerState } from "../../models/customer/CustomerState.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { ShippingBody } from "./course.validation";
import { COURIER } from "../../config/courier";
import logger from "../../utils/logger";
import { computeDaysLeft } from "../../utils/planDuration";

// ───────────────────────────────────────────────────────────────────────────
// Shipping
// ───────────────────────────────────────────────────────────────────────────

interface NormalizedShipping {
  customerId: Types.ObjectId;
  name: string;
  phone: string;
  alternatePhone: string | null;
  email: string | null;
  address: string;
  address2: string;
  city: string;
  stateId: Types.ObjectId | null;
  pincode: string;
}

function normalizeShipping(userId: string, body: ShippingBody): NormalizedShipping {
  const phoneNum = body.phone !== undefined && body.phone !== null ? Number(body.phone) : 0;
  const altNum =
    body.alternate_phone !== undefined && body.alternate_phone !== null
      ? Number(body.alternate_phone)
      : null;
  const pinNum = body.pincode !== undefined && body.pincode !== null ? Number(body.pincode) : 0;
  return {
    customerId: new Types.ObjectId(userId),
    name: body.name,
    phone: String(phoneNum || 0),
    alternatePhone: altNum !== null ? String(altNum) : null,
    email: body.email || null,
    address: body.address,
    address2: body.address_2,
    city: body.city,
    stateId: body.state ? new Types.ObjectId(body.state) : null,
    pincode: String(pinNum || 0),
  };
}

export async function upsertCourseOrderShipping(
  userId: string,
  body: ShippingBody,
  traceId?: string
) {
  logger.info("upsertCourseOrderShipping service invoked", { traceId, userId });
  const normalized = normalizeShipping(userId, body);

  // Mongoose's "alternatePhone: null" needs a conditional query — omit the key
  // when it's null so we match docs that may have the field missing or null.
  const matchQuery: Record<string, unknown> = {
    customerId: normalized.customerId,
    name: normalized.name,
    phone: normalized.phone,
    alternatePhone: normalized.alternatePhone,
    email: normalized.email,
    address: normalized.address,
    address2: normalized.address2,
    city: normalized.city,
    stateId: normalized.stateId,
    pincode: normalized.pincode,
  };

  let address = await CustomerAddress.findOne(matchQuery);
  if (!address) address = await CustomerAddress.create(normalized);

  let shipping = await CustomerShipping.findOne(matchQuery);
  if (!shipping) shipping = await CustomerShipping.create(normalized);

  const populated: any = await CustomerShipping.findById(shipping._id)
    .populate({ path: "stateId", model: CustomerState })
    .lean();

  if (!populated) {
    logger.warn("upsertCourseOrderShipping service populate missing", { traceId, userId, shippingId: shipping._id });
    return null;
  }

  // Match source response: `state` object, stringified numeric fields.
  populated.state = populated.stateId ?? null;
  populated.phone = `${populated.phone ?? ""}`;
  populated.alternate_phone = `${populated.alternatePhone ?? ""}`;
  populated.pincode = `${populated.pincode ?? ""}`;
  delete populated.stateId;
  delete populated.alternatePhone;
  logger.info("upsertCourseOrderShipping service completed", { traceId, userId, shippingId: shipping._id });
  return populated;
}

// ───────────────────────────────────────────────────────────────────────────
// Order details / invoice
// ───────────────────────────────────────────────────────────────────────────

export async function getOrderDetailsForUser(orderId: string, userId: string, traceId?: string) {
  logger.info("getOrderDetailsForUser service invoked", { traceId, orderId, userId });
  const subscription: any = await PackageCourseSubscription.findOne({
    _id: orderId,
    customerId: userId,
  })
    .populate({ path: "packageId", model: PackageCourseEbookPrice })
    .populate({ path: "courseId", model: Course })
    .populate({ path: "customerShippingId", model: CustomerShipping })
    .lean();

  if (!subscription) {
    logger.warn("getOrderDetailsForUser service not found", { traceId, orderId, userId });
    return null;
  }

  // Rename populated refs to source contract names
  subscription.package = subscription.packageId ?? null;
  subscription.course = subscription.courseId ?? null;
  subscription.customerShipping = subscription.customerShippingId ?? null;
  delete subscription.packageId;
  delete subscription.courseId;
  delete subscription.customerShippingId;

  if (subscription.trackingId !== null && subscription.trackingId !== undefined) {
    const tmp = Math.floor(Date.now() / 1000);
    const base =
      subscription.trackingId < COURIER.TIRUPATI.INITIAL_Number
        ? COURIER.MAHAVIR.BASE_URL
        : COURIER.TIRUPATI.BASE_URL;
    subscription.tracking_url = `${base}?Tmp=${tmp}&docno=${subscription.trackingId}`;
    subscription.tracking_id = subscription.trackingId;
  }
  delete subscription.trackingId;
  subscription.daysLeft = computeDaysLeft(subscription.endAt ?? null);
  logger.info("getOrderDetailsForUser service completed", { traceId, orderId, userId });
  return subscription;
}

export async function getOrderForInvoice(orderId: string, userId: string, traceId?: string) {
  logger.info("getOrderForInvoice service invoked", { traceId, orderId, userId });
  const sub = await PackageCourseSubscription.findOne({
    _id: orderId,
    customerId: userId,
  }).lean();
  if (!sub) logger.warn("getOrderForInvoice service not found", { traceId, orderId, userId });
  return sub;
}
