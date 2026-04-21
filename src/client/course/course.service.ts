import { Types } from "mongoose";
import { Course } from "../../models/course/Course.model";
import { CourseEducator } from "../../models/course/CourseEducator.model";
import { CourseSubjectCategory } from "../../models/course/CourseSubjectCategory.model";
import { Video } from "../../models/course/Video.model";
import { MaterialCategory } from "../../models/course/MaterialCategory.model";
import { Material } from "../../models/course/Material.model";
import { ExamCategory } from "../../models/exam/ExamCategory.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { PromotedPackageCourseEbook } from "../../models/course/PromotedPackageCourseEbook.model";
import { PromoCode } from "../../models/course/PromoCode.model";
import { CustomerAddress } from "../../models/customer/CustomerAddress.model";
import { CustomerShipping } from "../../models/customer/CustomerShipping.model";
import { CustomerState } from "../../models/customer/CustomerState.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import {
  generateKey,
  generateToken,
  generateVector,
  encrypt,
} from "../../utils/videoEncryption";
import { ShippingBody } from "./course.validation";
import { COURIER } from "../../config/courier";

export interface PromoCodeDTO {
  title: string;
  promocode: string;
  description: string;
}

export interface LectureDTO {
  _id: Types.ObjectId;
  videoCategoryId: Types.ObjectId;
  title?: string;
  platform: "youtube" | "aws" | "vimeo";
  order: number;
  status: boolean;
  token: string;
  videoURL: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CategoryDTO {
  _id: Types.ObjectId;
  title: string;
  image?: string | null;
  parent: Types.ObjectId | null;
  order: number;
  status: boolean;
  havingChildDirectory: boolean;
  count: string | number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CourseDetailsResponse {
  course: any;
  lectures: LectureDTO[];
  materials: CategoryDTO[];
  exams: CategoryDTO[];
  plans: {
    withMaterial: any[];
    withoutMaterial: any[];
  };
  availablePromoCode: PromoCodeDTO[];
}

/**
 * Recursively counts leaf Materials under a MaterialCategory subtree.
 * Returns a stringified count to preserve wire compatibility with the old API
 * (which typed this as string and always returned "").
 */
export async function findMaterialCounts(id: Types.ObjectId | string): Promise<string> {
  const children = await MaterialCategory.find({ parent: id, status: true })
    .select("_id")
    .lean();
  if (children.length === 0) {
    const count = await Material.countDocuments({ materialCategoryId: id, status: true });
    return String(count);
  }
  const counts = await Promise.all(children.map((c) => findMaterialCounts(c._id as any)));
  const total = counts.reduce((a, b) => a + Number(b || 0), 0);
  return String(total);
}

export async function findExamCounts(_id: Types.ObjectId | string): Promise<string> {
  return "";
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

  // Project the populated subject/educator under the source-contract keys.
  const course: any = {
    ...courseDoc,
    subject: (courseDoc as any).courseSubjectCategoryId ?? null,
    educator: (courseDoc as any).courseEducatorId ?? null,
  };
  delete course.courseSubjectCategoryId;
  delete course.courseEducatorId;
  delete course.materialCategories;
  delete course.examCategories;

  // Lectures — encrypted per-lecture URL
  const rawLectures = courseDoc.videoCategoryId
    ? await Video.find({ videoCategoryId: courseDoc.videoCategoryId, status: true })
        .sort({ order: 1 })
        .lean()
    : [];

  const lectures: LectureDTO[] = await Promise.all(
    rawLectures.map(async (lecture) => {
      const token = generateToken(16);
      const key = generateKey(token);
      const vector = generateVector(token);
      const sourceId =
        lecture.platform === "youtube"
          ? lecture.youtube_id
          : lecture.platform === "aws"
          ? lecture.aws_id
          : lecture.vimeo_id;
      const videoURL = sourceId ? encrypt(sourceId, key, vector) : "";
      return {
        _id: lecture._id,
        videoCategoryId: lecture.videoCategoryId,
        title: lecture.title,
        platform: lecture.platform,
        order: lecture.order,
        status: lecture.status,
        token,
        videoURL,
        createdAt: lecture.createdAt,
        updatedAt: lecture.updatedAt,
      };
    })
  );

  // Materials (from embedded join, preserve order)
  const materialRefs = [...((courseDoc as any).materialCategories ?? [])].sort(
    (a: any, b: any) => (a.order ?? 0) - (b.order ?? 0)
  );
  const materials: CategoryDTO[] = (
    await Promise.all(
      materialRefs.map(async (ref: any) => {
        const cat = ref.category;
        if (!cat || cat.status !== true) return null;
        const [childCount, count] = await Promise.all([
          MaterialCategory.countDocuments({ parent: cat._id }),
          findMaterialCounts(cat._id),
        ]);
        return {
          _id: cat._id,
          title: cat.title,
          image: cat.image ?? null,
          parent: cat.parent ?? null,
          order: cat.order,
          status: cat.status,
          havingChildDirectory: childCount > 0,
          count,
          createdAt: cat.createdAt,
          updatedAt: cat.updatedAt,
        } as CategoryDTO;
      })
    )
  ).filter((x): x is CategoryDTO => x !== null);

  // Exams (same pattern)
  const examRefs = [...((courseDoc as any).examCategories ?? [])].sort(
    (a: any, b: any) => (a.order ?? 0) - (b.order ?? 0)
  );
  const exams: CategoryDTO[] = (
    await Promise.all(
      examRefs.map(async (ref: any) => {
        const cat = ref.category;
        if (!cat || cat.status !== true) return null;
        const [childCount, count] = await Promise.all([
          ExamCategory.countDocuments({ parentId: cat._id }),
          findExamCounts(cat._id),
        ]);
        return {
          _id: cat._id,
          title: cat.name,
          image: cat.image ?? null,
          parent: cat.parentId ?? null,
          order: cat.orderBy,
          status: cat.status,
          havingChildDirectory: childCount > 0,
          count,
          createdAt: cat.createdAt,
          updatedAt: cat.updatedAt,
        } as CategoryDTO;
      })
    )
  ).filter((x): x is CategoryDTO => x !== null);

  // Plans
  const AllPlans = await PackageCourseEbookPrice.find({
    courseId: courseDoc._id,
    status: true,
  })
    .sort({ duration: 1 })
    .lean();

  const allPlanIds = AllPlans.map((p) => p._id);
  const promotedPlans = await PromotedPackageCourseEbook.find({
    planId: { $in: allPlanIds },
  })
    .populate({
      path: "promocodeId",
      match: { type: "public" },
      model: PromoCode,
    })
    .lean();

  const now = new Date();
  const availablePromoCode: PromoCodeDTO[] = [];
  for (const p of promotedPlans) {
    const promo: any = (p as any).promocodeId;
    if (!promo) continue;
    if (
      new Date(promo.promo_start_at) <= now &&
      new Date(promo.promo_expire_at) >= now
    ) {
      if (
        availablePromoCode.findIndex((x) => x.promocode === promo.promocode) < 0
      ) {
        availablePromoCode.push({
          title: promo.title,
          promocode: promo.promocode,
          description: promo.description,
        });
      }
    }
  }

  const plans = {
    withMaterial: AllPlans.filter((p) => p.withMaterial === true),
    withoutMaterial: AllPlans.filter((p) => p.withMaterial === false),
  };

  return { course, lectures, materials, exams, plans, availablePromoCode };
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
