import { Types } from "mongoose";
import { Course } from "../../models/course/Course.model";
import { CourseEducator } from "../../models/course/CourseEducator.model";
import { CourseSubjectCategory } from "../../models/course/CourseSubjectCategory.model";
import { MaterialCategory } from "../../models/course/MaterialCategory.model";
import { Material } from "../../models/course/Material.model";
import { Video } from "../../models/course/Video.model";
import { ExamCategory } from "../../models/exam/ExamCategory.model";
import { Exam } from "../../models/exam/Exam.model";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { VideoCategoryRelation } from "../../models/course/VideoCategoryRelation.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { PromoCode } from "../../models/course/PromoCode.model";
import { CustomerAddress } from "../../models/customer/CustomerAddress.model";
import { CustomerShipping } from "../../models/customer/CustomerShipping.model";
import { CustomerState } from "../../models/customer/CustomerState.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { ShippingBody } from "./course.validation";
import { COURIER } from "../../config/courier";

export interface PromoCodeDTO {
  title: string;
  promocode: string;
  description: string;
}

export interface CategoryGroupDTO {
  category: any;
}

export interface CourseDetailsResponse {
  course: any;
  videos: CategoryGroupDTO[];
  materials: CategoryGroupDTO[];
  tests: CategoryGroupDTO[];
  plans: {
    withMaterial: any[];
    withoutMaterial: any[];
  };
  availablePromoCode: PromoCodeDTO[];
}

export async function buildCourseDetails(
  courseId: string
): Promise<CourseDetailsResponse | null> {
  const courseDoc = await Course.findById(courseId)
    .populate({ path: "courseSubjectCategoryId", model: CourseSubjectCategory })
    .populate({ path: "courseEducatorId", model: CourseEducator })
    .populate({ path: "materialCategories.category", model: MaterialCategory })
    .populate({ path: "examCategories.category", model: ExamCategory })
    .lean();

  if (!courseDoc) return null;

  // Keep the populated relations and expose friendly aliases for the client.
  const course: any = {
    ...courseDoc,
    subject: (courseDoc as any).courseSubjectCategoryId ?? null,
    educator: (courseDoc as any).courseEducatorId ?? null,
  };
  delete course.courseSubjectCategoryId;
  delete course.materialCategories;
  delete course.examCategories;

  // Videos — Course has a single videoCategoryId; expose as one-entry videos[]
  const videos: CategoryGroupDTO[] = [];
  if (courseDoc.videoCategoryId) {
    const videoCat: any = await VideoCategory.findById(courseDoc.videoCategoryId).lean();
    if (videoCat) {
      const [count, childCount] = await Promise.all([
        Video.countDocuments({ videoCategoryId: videoCat._id, status: true }),
        VideoCategoryRelation.countDocuments({ parent: videoCat._id }),
      ]);
      videos.push({
        category: {
          ...videoCat,
          havingChildDirectory: childCount > 0,
          count,
        },
      });
    }
  }

  // Materials — category groups with full category details + count
  const materialRefs = [...((courseDoc as any).materialCategories ?? [])].sort(
    (a: any, b: any) => (a.order ?? 0) - (b.order ?? 0)
  );
  const activeMaterialCats = materialRefs
    .map((ref: any) => ref.category)
    .filter((cat: any) => cat && cat.status === true);
  const [materialChildCounts, materialCounts] = await Promise.all([
    Promise.all(activeMaterialCats.map((cat: any) => MaterialCategory.countDocuments({ parent: cat._id, status: true }))),
    Promise.all(activeMaterialCats.map((cat: any) => Material.countDocuments({ materialCategoryId: cat._id, status: true }))),
  ]);
  const materials: CategoryGroupDTO[] = activeMaterialCats.map((cat: any, i: number) => ({
    category: {
      ...cat,
      havingChildDirectory: materialChildCounts[i] > 0,
      count: materialCounts[i],
    },
  }));

  // Tests — exam categories with full category details + exam count
  const examRefs = [...((courseDoc as any).examCategories ?? [])].sort(
    (a: any, b: any) => (a.order ?? 0) - (b.order ?? 0)
  );
  const activeExamCats = examRefs
    .map((ref: any) => ref.category)
    .filter((cat: any) => cat && cat.status === true);
  const [examChildCounts, examCounts] = await Promise.all([
    Promise.all(activeExamCats.map((cat: any) => ExamCategory.countDocuments({ parentId: cat._id, status: true }))),
    Promise.all(activeExamCats.map((cat: any) => Exam.countDocuments({ categoryId: cat._id }))),
  ]);
  const tests: CategoryGroupDTO[] = activeExamCats.map((cat: any, i: number) => ({
    category: {
      ...cat,
      title: cat.name,
      havingChildDirectory: examChildCounts[i] > 0,
      count: examCounts[i],
    },
  }));

  // Plans
  const AllPlans = await PackageCourseEbookPrice.find({
    courseId: courseDoc._id,
    status: true,
  })
    .sort({ duration: 1 })
    .lean();

  const now = new Date();
  const promos = await PromoCode.find({
    type: "public",
    status: true,
    promo_start_at: { $lte: now },
    promo_expire_at: { $gte: now },
    "appliesTo.type": "course",
    "appliesTo.ids": courseDoc._id,
  })
    .select("promocode title description")
    .lean();

  const availablePromoCode: PromoCodeDTO[] = promos.map((p: any) => ({
    title: p.title ?? "",
    promocode: p.promocode,
    description: p.description ?? "",
  }));

  const plans = {
    withMaterial: AllPlans.filter((p) => p.withMaterial === true),
    withoutMaterial: AllPlans.filter((p) => p.withMaterial === false),
  };

  return { course, videos, materials, tests, plans, availablePromoCode };
}

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
  body: ShippingBody
) {
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

  if (!populated) return null;

  // Match source response: `state` object, stringified numeric fields.
  populated.state = populated.stateId ?? null;
  populated.phone = `${populated.phone ?? ""}`;
  populated.alternate_phone = `${populated.alternatePhone ?? ""}`;
  populated.pincode = `${populated.pincode ?? ""}`;
  delete populated.stateId;
  delete populated.alternatePhone;
  return populated;
}

// ───────────────────────────────────────────────────────────────────────────
// Order details / invoice
// ───────────────────────────────────────────────────────────────────────────

export async function getOrderDetailsForUser(orderId: string, userId: string) {
  const subscription: any = await PackageCourseSubscription.findOne({
    _id: orderId,
    customerId: userId,
  })
    .populate({ path: "packageId", model: PackageCourseEbookPrice })
    .populate({ path: "courseId", model: Course })
    .populate({ path: "customerShippingId", model: CustomerShipping })
    .lean();

  if (!subscription) return null;

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
  return subscription;
}

export async function getOrderForInvoice(orderId: string, userId: string) {
  return PackageCourseSubscription.findOne({
    _id: orderId,
    customerId: userId,
  }).lean();
}
