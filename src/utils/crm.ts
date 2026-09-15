// TeleCRM lead push — port of the old Mongo backend's GenerateCRMLead
// (docs/old-telecrm-integration.md), extended with live-course/test-series.
import axios from "axios";
import logger from "./logger";
import { prisma } from "../config/prisma";
import { callOutbound } from "../libs/outbound";
import { TELE_CRM, isTeleCrmConfigured } from "../config/telecrm";
import { CRM_LEAD_TYPE } from "../shared/enums";

export interface GenerateCRMLeadParams {
  userId: string | number;
  packageId?: string | number | null;
  courseId?: string | number | null;
  liveCourseId?: string | number | null;
  testSeriesId?: string | number | null;
  planId?: string | number | null;
  amount?: number | null;
}

export interface GenerateCRMLeadArgs {
  params: GenerateCRMLeadParams;
  leadType: CRM_LEAD_TYPE;
}

interface ProductContext {
  name: string | null;
  suffix: string | null;
}

const toId = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const nowFormatted = (): string =>
  new Date().toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

async function resolveProductAndSkip(
  customerId: number,
  params: GenerateCRMLeadParams
): Promise<{ product: ProductContext | null; skip: boolean; planName: string | null }> {
  const now = new Date();
  const packageId = toId(params.packageId);
  const courseId = toId(params.courseId);
  const liveCourseId = toId(params.liveCourseId);
  const testSeriesId = toId(params.testSeriesId);
  const planId = toId(params.planId);

  if (testSeriesId) {
    const [series, activeSub, plan] = await Promise.all([
      prisma.testSeries.findUnique({ where: { id: testSeriesId }, select: { title: true } }),
      prisma.testSeriesSubscription.findFirst({
        where: { customerId, testSeriesId, endAt: { gt: now } },
        select: { id: true },
      }),
      planId ? prisma.testSeriesPrice.findUnique({ where: { id: planId }, select: { name: true } }) : Promise.resolve(null),
    ]);
    return {
      product: series ? { name: series.title, suffix: null } : null,
      skip: !!activeSub,
      planName: plan?.name ?? null,
    };
  }

  if (liveCourseId) {
    const [liveCourse, activeSub, plan] = await Promise.all([
      prisma.liveCourse.findUnique({ where: { id: liveCourseId }, select: { name: true } }),
      prisma.liveCourseSubscription.findFirst({
        where: { customerId, liveCourseId, endAt: { gt: now } },
        select: { id: true },
      }),
      planId ? prisma.liveCoursePlan.findUnique({ where: { id: planId }, select: { name: true } }) : Promise.resolve(null),
    ]);
    return {
      product: liveCourse ? { name: liveCourse.name, suffix: null } : null,
      skip: !!activeSub,
      planName: plan?.name ?? null,
    };
  }

  if (packageId || courseId) {
    const [activeSub, plan] = await Promise.all([
      prisma.packageCourseSubscription.findFirst({
        where: {
          customerId,
          ...(packageId ? { packageId } : {}),
          ...(courseId ? { courseId } : {}),
          endAt: { gt: now },
        },
        select: { id: true },
      }),
      planId ? prisma.packageCourseEbookPrice.findUnique({ where: { id: planId }, select: { name: true } }) : Promise.resolve(null),
    ]);

    if (packageId) {
      const pkg = await prisma.package.findUnique({ where: { id: packageId }, select: { name: true } });
      return { product: pkg ? { name: pkg.name, suffix: null } : null, skip: !!activeSub, planName: plan?.name ?? null };
    }

    const course = await prisma.course.findUnique({
      where: { id: courseId! },
      select: { name: true, educator: { select: { name: true } } },
    });
    return {
      product: course ? { name: course.name ?? "", suffix: course.educator?.name ?? null } : null,
      skip: !!activeSub,
      planName: plan?.name ?? null,
    };
  }

  return { product: null, skip: false, planName: null };
}

// Old backend always sent this literal (never the real course name) for
// course-context leads — kept as-is since TeleCRM automations may filter on it.
const COURSE_APPLICATION_LABEL = "Subject Wise Course";

function buildApplicationCourse(
  params: GenerateCRMLeadParams,
  product: ProductContext | null
): string | undefined {
  if (params.courseId) return COURSE_APPLICATION_LABEL;
  return product?.name ?? undefined;
}

function buildSystemNote(
  leadType: CRM_LEAD_TYPE,
  params: GenerateCRMLeadParams,
  product: ProductContext | null,
  planName: string | null,
  now: string
): string {
  const productLabel = product?.name ?? "";
  const suffix = product?.suffix ? ` - ${product.suffix}` : "";
  const amount = params.amount ? ` - ${params.amount}` : "";

  switch (leadType) {
    case CRM_LEAD_TYPE.LOGIN:
      return `Application Login - ${now}`;
    case CRM_LEAD_TYPE.SIGNUP:
      return `Application Signup - ${now}`;
    case CRM_LEAD_TYPE.VIEW_PACKAGE:
      return `View Package - ${productLabel} - ${now}`;
    case CRM_LEAD_TYPE.VIEW_COURSE:
      return `View Course - ${productLabel}${suffix} - ${now}`;
    case CRM_LEAD_TYPE.VIEW_LIVE_COURSE:
      return `View Live Course - ${productLabel} - ${now}`;
    case CRM_LEAD_TYPE.VIEW_TEST_SERIES:
      return `View Test Series - ${productLabel} - ${now}`;
    case CRM_LEAD_TYPE.PAYMENT_MODE:
      return `Payment Mode - ${productLabel} - ${planName ?? ""}${amount} - ${now}`;
    case CRM_LEAD_TYPE.PAYMENT_SUCCESS:
      return `Payment Success - ${productLabel} - ${planName ?? ""}${amount} - ${now}`;
    case CRM_LEAD_TYPE.PAYMENT_FAILED:
      return `Payment Failed - ${productLabel}${amount} - ${now}`;
    default:
      return `${leadType} - ${now}`;
  }
}

interface TeleCrmPayload {
  fields: {
    name: string;
    email: string;
    phone: string;
    application_course?: string;
    amount?: number;
  };
  actions: { type: "SYSTEM_NOTE"; text: string }[];
}

async function sendToTeleCrm(payload: TeleCrmPayload): Promise<void> {
  await callOutbound(
    () => axios.post(TELE_CRM.BASE_URL, payload, { headers: { Authorization: `Bearer ${TELE_CRM.ACCESS_TOKEN}` } }),
    { label: "telecrm.lead", timeoutMs: 5_000, attempts: 2 }
  );
}

export async function GenerateCRMLead(args: GenerateCRMLeadArgs): Promise<void> {
  const { params, leadType } = args;

  try {
    if (process.env.NODE_ENV !== "production") return;
    if (!isTeleCrmConfigured()) return;

    const customerId = toId(params.userId);
    if (!customerId) return;

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { fullName: true, emailAddress: true, phoneNumber: true },
    });
    if (!customer) return;
    if (customer.phoneNumber && TELE_CRM.TESTING_ACCOUNTS.includes(customer.phoneNumber)) return;

    const { product, skip, planName } = await resolveProductAndSkip(customerId, params);
    if (skip) return;

    const now = nowFormatted();
    const applicationCourse = buildApplicationCourse(params, product);

    const payload: TeleCrmPayload = {
      fields: {
        name: customer.fullName ?? "",
        email: customer.emailAddress ?? "",
        phone: customer.phoneNumber ?? "",
        ...(applicationCourse ? { application_course: applicationCourse } : {}),
        ...(params.amount ? { amount: params.amount } : {}),
      },
      actions: [{ type: "SYSTEM_NOTE", text: buildSystemNote(leadType, params, product, planName, now) }],
    };

    await sendToTeleCrm(payload);
    logger.info("GenerateCRMLead sent", { leadType, userId: customerId });
  } catch (err) {
    logger.warn("GenerateCRMLead failed", { leadType, userId: params.userId, error: (err as Error)?.message });
  }
}

/**
 * Fire-and-forget entry point — the only way call sites should invoke a lead.
 * Hides setImmediate/void/catch so callers are a single line.
 */
export function queueCRMLead(args: GenerateCRMLeadArgs, logContext: Record<string, unknown> = {}): void {
  setImmediate(() => {
    GenerateCRMLead(args).catch((err) => {
      logger.warn("queueCRMLead failed", { ...logContext, leadType: args.leadType, error: (err as Error)?.message });
    });
  });
}
