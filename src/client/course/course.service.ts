import { prisma } from "../../config/prisma";
import { customerAddressRepository } from "../../modules/customer-address/customer-address.repository";
import { buildTrackingUrl } from "../../config/courier";
import { toCourseDto } from "../../modules/catalog-course/catalog-course.transformer";
import { ShippingBody } from "./course.validation";
import logger from "../../utils/logger";
import { computeDaysLeft } from "../../utils/planDuration";

// ───────────────────────────────────────────────────────────────────────────
// Shipping
// ───────────────────────────────────────────────────────────────────────────

/**
 * Normalized shipping values in the SQL (`ws_customer_address` /
 * `ws_customer_shipping`) column TYPES: phone/alternate_phone are BIGINT,
 * pincode is INT, state is an INT FK, userId is the int customer id.
 *
 * Mirrors the pre-migration Mongo normalizer: phone/pincode coerced through
 * `Number()` (defaulting to 0), alternate_phone left null when absent.
 * `email` becomes "" when absent because the SQL column is NOT NULL (the DTO
 * re-derives null from "" so the response shape is unchanged).
 * `state` is only kept when it is a numeric FK — the input contract still
 * accepts a 24-hex Mongo ObjectId (see course.validation.ts), which has no SQL
 * FK, so such a value normalizes to null.
 */
interface NormalizedShipping {
  userId: number;
  name: string;
  phone: bigint;
  alternatePhone: bigint | null;
  email: string;
  address: string;
  address2: string;
  city: string;
  state: number | null;
  pincode: number;
}

/** "9664796376" | 9664796376 → 9664796376n; non-numeric/empty → 0n. */
function toPhoneBig(v: string | number | null | undefined): bigint {
  if (v === null || v === undefined || v === "") return BigInt(0);
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n > 0 ? BigInt(n) : BigInt(0);
}

function normalizeShipping(userId: string, body: ShippingBody): NormalizedShipping {
  const alternatePhone =
    body.alternate_phone !== undefined && body.alternate_phone !== null
      ? toPhoneBig(body.alternate_phone)
      : null;
  const pinNum = Math.trunc(Number(body.pincode));
  const stateNum =
    body.state && /^\d+$/.test(String(body.state)) ? Number(body.state) : null;
  return {
    userId: Number(userId),
    name: body.name,
    phone: toPhoneBig(body.phone),
    alternatePhone,
    email: body.email || "",
    address: body.address,
    address2: body.address_2,
    city: body.city,
    state: stateNum,
    pincode: Number.isFinite(pinNum) ? pinNum : 0,
  };
}

/** Populated `state` object (Mongo `CustomerState` populate shape) or null. */
function toStateObject(
  s: { id: number; name: string; state_code: string; active: boolean } | null | undefined
) {
  return s
    ? { _id: String(s.id), name: s.name, stateCode: s.state_code, active: s.active }
    : null;
}

/**
 * Find-or-create the customer's shipping address, then return the shipping row
 * with its `state` populated — identical response shape to the pre-migration
 * Mongo path (`state` object, stringified numeric fields).
 *
 * Mirrors the Mongo find-or-create semantics faithfully: a matching row is one
 * whose owner + every address field (name/phone/alternate_phone/email/address/
 * address_2/city/state/pincode) equals the normalized input, so re-submitting
 * the same address never creates a duplicate. The CustomerAddress write is a
 * side-effect (the address book); the CustomerShipping row is what's returned.
 */
export async function upsertCourseOrderShipping(
  userId: string,
  body: ShippingBody,
  traceId?: string
) {
  logger.info("upsertCourseOrderShipping service invoked", { traceId, userId });
  const n = normalizeShipping(userId, body);

  // Exact-field match predicate shared by the address + shipping lookups (mirrors
  // the Mongo `findOne(matchQuery)`; `alternate_phone`/`state` null match null).
  const match = {
    userId: n.userId,
    name: n.name,
    phone: n.phone,
    alternate_phone: n.alternatePhone,
    email: n.email,
    address: n.address,
    address_2: n.address2,
    city: n.city,
    state: n.state,
    pincode: n.pincode,
  };

  // ── CustomerAddress (address book side-effect) ──
  const address = await prisma.customerAddress.findFirst({ where: match });
  if (!address) {
    // Reuse the customer-address repo's create (owns the address-column write).
    await customerAddressRepository.create({
      customerId: n.userId,
      name: n.name,
      phone: String(n.phone),
      alternatePhone: n.alternatePhone !== null ? String(n.alternatePhone) : null,
      email: n.email,
      address: n.address,
      address2: n.address2,
      city: n.city,
      stateId: n.state,
      pincode: String(n.pincode),
      status: true,
    });
  }

  // ── CustomerShipping (the returned row) ──
  let shipping = await prisma.customerShipping.findFirst({ where: match });
  if (!shipping) {
    shipping = await prisma.customerShipping.create({
      data: {
        name: n.name,
        phone: n.phone,
        alternate_phone: n.alternatePhone,
        email: n.email,
        address: n.address,
        address_2: n.address2,
        city: n.city,
        state: n.state,
        pincode: n.pincode,
        userId: n.userId,
        status: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });
  }

  const populated = await prisma.customerShipping.findUnique({
    where: { id: shipping.id },
    include: { State: true },
  });

  if (!populated) {
    logger.warn("upsertCourseOrderShipping service populate missing", {
      traceId,
      userId,
      shippingId: shipping.id,
    });
    return null;
  }

  logger.info("upsertCourseOrderShipping service completed", {
    traceId,
    userId,
    shippingId: shipping.id,
  });

  // Match source response: `state` object, stringified numeric fields, `email`
  // null when unset (SQL stores "" for the NOT-NULL column), `alternate_phone`
  // "" when unset.
  return {
    _id: String(populated.id),
    name: populated.name,
    phone: `${populated.phone ?? ""}`,
    alternate_phone:
      populated.alternate_phone !== null && populated.alternate_phone !== undefined
        ? String(populated.alternate_phone)
        : "",
    email: populated.email || null,
    address: populated.address,
    address2: populated.address_2,
    city: populated.city,
    state: toStateObject(populated.State),
    pincode: `${populated.pincode ?? ""}`,
    customerId: populated.userId !== null && populated.userId !== undefined ? String(populated.userId) : null,
    status: populated.status ?? true,
    createdAt: populated.created_at ?? null,
    updatedAt: populated.updated_at ?? null,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Order details / invoice
// ───────────────────────────────────────────────────────────────────────────

/** Prisma Decimal | number | null → number | null. */
function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  const num = Number((v as { toString(): string }).toString());
  return Number.isFinite(num) ? num : null;
}

/** Populated plan (Mongo `PackageCourseEbookPrice`) sub-object. */
function toPlanDto(p: {
  id: number;
  courseId: number | null;
  packageId: number | null;
  ebookId: number | null;
  name: string | null;
  duration: number;
  price: number;
  withMaterial: boolean;
  materialPrice: number | null;
  isDefault: boolean;
  status: boolean;
  created_at: Date | null;
  updated_at: Date | null;
}) {
  return {
    _id: String(p.id),
    courseId: p.courseId !== null ? String(p.courseId) : null,
    packageId: p.packageId !== null ? String(p.packageId) : null,
    ebookId: p.ebookId !== null ? String(p.ebookId) : null,
    name: p.name ?? null,
    duration: p.duration,
    price: p.price,
    withMaterial: p.withMaterial,
    materialPrice: p.materialPrice ?? 0,
    isDefault: p.isDefault,
    status: p.status,
    createdAt: p.created_at ?? null,
    updatedAt: p.updated_at ?? null,
  };
}

/**
 * Populated `customerShipping` sub-object — the RAW shipping doc (Mongo does NOT
 * further-populate its `stateId` here), using the Mongo field names
 * (`alternatePhone`/`stateId`/`address2`). Optional fields are omitted when
 * unset so the JSON matches the Mongo lean doc.
 */
function toShippingSubDto(s: {
  id: number;
  name: string;
  phone: bigint;
  alternate_phone: bigint | null;
  email: string;
  address: string;
  address_2: string;
  city: string;
  state: number | null;
  pincode: number;
  userId: number | null;
  status: boolean | null;
  created_at: Date | null;
  updated_at: Date | null;
}) {
  return {
    _id: String(s.id),
    name: s.name,
    phone: `${s.phone ?? ""}`,
    ...(s.alternate_phone !== null && s.alternate_phone !== undefined
      ? { alternatePhone: String(s.alternate_phone) }
      : {}),
    ...(s.email ? { email: s.email } : {}),
    address: s.address,
    address2: s.address_2,
    city: s.city,
    ...(s.state !== null && s.state !== undefined ? { stateId: String(s.state) } : {}),
    pincode: `${s.pincode ?? ""}`,
    ...(s.userId !== null && s.userId !== undefined ? { customerId: String(s.userId) } : {}),
    status: s.status ?? true,
    createdAt: s.created_at ?? null,
    updatedAt: s.updated_at ?? null,
  };
}

export async function getOrderDetailsForUser(orderId: string, userId: string, traceId?: string) {
  logger.info("getOrderDetailsForUser service invoked", { traceId, orderId, userId });

  const idNum = Number(orderId);
  const custNum = Number(userId);
  if (!Number.isInteger(idNum) || idNum <= 0 || !Number.isInteger(custNum)) {
    logger.warn("getOrderDetailsForUser service invalid id (sql)", { traceId, orderId, userId });
    return null;
  }

  const sub = await prisma.packageCourseSubscription.findFirst({
    where: { id: idNum, customerId: custNum },
    include: {
      packageCourseEbookPrice: true, // Mongo `packageId` populate = the plan row
      course: true,
      customerShipping: true,
    },
  });

  if (!sub) {
    logger.warn("getOrderDetailsForUser service not found", { traceId, orderId, userId });
    return null;
  }

  const trackingNum = sub.trackingId !== null && sub.trackingId !== undefined ? Number(sub.trackingId) : null;

  const result: Record<string, unknown> = {
    _id: String(sub.id),
    customerId: sub.customerId !== null && sub.customerId !== undefined ? String(sub.customerId) : null,
    // SQL name mapping (see commerce-subscription): pcb_id (planId) → Mongo
    // `packageId` (the plan), package_id → Mongo `targetPackageId` (the package).
    courseId: sub.courseId !== null ? String(sub.courseId) : null,
    targetPackageId: sub.packageId !== null ? String(sub.packageId) : null,
    packageId: sub.planId !== null ? String(sub.planId) : null,
    startAt: sub.startAt ?? null,
    endAt: sub.endAt ?? null,
    status: sub.status,
    amount: toNum(sub.amount),
    courseAmount: toNum(sub.courseAmount),
    materialAmount: toNum(sub.materialAmount),
    paidAmount: toNum(sub.paidAmount),
    createdAt: sub.createdAt ?? null,
    updatedAt: sub.updatedAt ?? null,
    // Renamed populated refs to the source contract names.
    package: sub.packageCourseEbookPrice ? toPlanDto(sub.packageCourseEbookPrice) : null,
    course: sub.course ? toCourseDto(sub.course) : null,
    customerShipping: sub.customerShipping ? toShippingSubDto(sub.customerShipping) : null,
  };

  if (trackingNum !== null) {
    result.tracking_url = buildTrackingUrl(trackingNum);
    result.tracking_id = trackingNum;
  }
  result.daysLeft = computeDaysLeft(sub.endAt ?? null);

  logger.info("getOrderDetailsForUser service completed", { traceId, orderId, userId });
  return result;
}
