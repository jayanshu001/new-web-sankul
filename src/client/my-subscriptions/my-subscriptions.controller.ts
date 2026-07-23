import { Request, Response } from "express";
import { z } from "zod";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { matchesAllTokens } from "../../utils/searchFilter";
import { omit } from "../../utils/pick";
import * as mySubSql from "../../modules/client-my-subscriptions/client-my-subscriptions.service";
import * as tsOrderSql from "../../modules/test-series-order/test-series-order.service";

// `type` selects which subscription library to return. Defaults to "course",
// which preserves the original behaviour (course + package together) for
// callers that don't send the param.
//   - course      → course, package AND live-course subscriptions, each tagged
//                   with its own `action.kind` ("course" | "package" | "live_course")
//   - test_series → test-series subscriptions
//   - ebook       → ebook subscriptions
const querySchema = z.object({
  type: z.enum(["course", "test_series", "ebook"]).default("course"),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// Every type returns this same card envelope so the FE renders one list and
// switches only on `action.kind`.
type Card = {
  _id: any;
  title: string;
  author: string | null;
  thumbnail: string | null;
  badge: string | null;
  daysLeft: number | null;
  startAt: Date | null;
  endAt: Date | null;
  action: {
    kind: "course" | "package" | "live_course" | "test_series" | "ebook";
    courseId: any;
    packageId: any;
    planId: any;
    testSeriesId: any;
    ebookId: any;
    liveCourseId: any;
  };
  meta: Record<string, any>;
};

// GET /api/v1/client/my-subscriptions?type=course|test_series|ebook
// Drives the "My Subscriptions" library screen — shows only currently-active
// subscriptions (verified payment AND endAt in the future) for the requested
// type. Sorted by endAt ascending so expiring-soonest cards surface first.
export const listMySubscriptions = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("listMySubscriptions invoked", { traceId, path: req.originalUrl, customerId: userId });

  try {
    if (!userId) { logger.warn("listMySubscriptions unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) { logger.warn("listMySubscriptions validation failed", { traceId, customerId: userId, issues: parsed.error.issues }); return res.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? "Invalid query", errors: parsed.error.issues }); }
    const { type, page: pageNum, limit: limitNum } = parsed.data;
    const search = parsed.data.search?.trim();
    const skip = (pageNum - 1) * limitNum;

    const now = new Date();
    // Each builder returns the FULL deduped+sorted card list for its type; the
    // shared tail paginates and shapes the response identically. course/package +
    // ebook come from client-my-subscriptions; test_series from test-series-order
    // (ws_test_series* tables). The SQL customer id is the numeric req.user.id.
    const numericCid = mySubSql.parseMySubId(String(userId));

    let cards: Card[];
    if (numericCid == null) {
      cards = [];
    } else if (type === "test_series") {
      cards = (await tsOrderSql.buildTestSeriesCards(numericCid, now)) as unknown as Card[];
    } else if (type === "ebook") {
      cards = (await mySubSql.buildEbookCards(numericCid, now)) as unknown as Card[];
    } else {
      // "course" tab = recorded course + package + live-course subscriptions,
      // merged and re-sorted soonest-expiring first (lifetime endAt=null last).
      const [courseAndPackage, liveCourse] = await Promise.all([
        mySubSql.buildCourseAndPackageCards(numericCid, now),
        mySubSql.buildLiveCourseCards(numericCid, now),
      ]);
      cards = [...courseAndPackage, ...liveCourse].sort(
        (a, b) => (a.endAt ? a.endAt.getTime() : Infinity) - (b.endAt ? b.endAt.getTime() : Infinity)
      ) as unknown as Card[];
    }

    // `?search=` filters the built cards on their display title (case-insensitive)
    // before paginating, so `total` reflects the filtered set.
    if (search) {
      cards = cards.filter((c) => matchesAllTokens(search, [c.title]));
    }

    const total = cards.length;
    const data = cards.slice(skip, skip + limitNum);

    // Slim each card to what MySubscriptions/Home read (see
    // docs/api-optimization/GET_client_my_subscriptions.md): keep nav ids in
    // `action` (minus planId); drop unused card meta. Pagination is untouched.
    const slim = data.map((c) => ({
      ...omit(c, ["_id", "author", "startAt", "endAt", "meta"]),
      action: omit(c.action, ["planId"]),
    }));
    logger.info("listMySubscriptions success", { traceId, customerId: userId, type, total, returned: data.length });
    return res.status(200).json({
      success: true,
      data: slim,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (e: any) {
    logger.error("listMySubscriptions failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
