// Admin ebooks: catalog, trending and plan logic over the admin-ebook module.
import { HttpError } from "../../middlewares/errorHandler";
import { planInUseMessage } from "../../utils/planUsage";
import { PLAN_TERMS_FROZEN_MESSAGE } from "../../modules/admin-plan/admin-plan.service";
import cache, { CacheDomain } from "../../libs/cache";
import { CacheEntity } from "../../middlewares/flushGroups";
import * as adminEbook from "../../modules/admin-ebook/admin-ebook.service";

export const parseEbookId = adminEbook.parseEbookId;

const assertEbookSqlId = (id: string, label: string): number => {
  const n = adminEbook.parseEbookId(id);
  if (!n) throw new HttpError(400, `Invalid ${label} ID`);
  return n;
};

const ebookDetailKey = (id: string) => cache.key(CacheDomain.Admin, CacheEntity.Ebook, `detail:${id}`);

const invalidateEbookCaches = async (ebookId?: string) => {
  const keys: string[] = [];
  if (ebookId) keys.push(ebookDetailKey(ebookId));
  await Promise.all([
    cache.invalidate(...keys),
    cache.invalidateByPrefix(cache.keyPrefix(CacheDomain.Admin, CacheEntity.Ebook, "list:")),
  ]);
};

export interface ListEbooksQuery {
  search?: string;
  author?: string;
  publisher?: string;
  language?: string;
  status?: string;
  page?: string;
  limit?: string;
}

export const listEbooks = async (query: ListEbooksQuery) => {
  return adminEbook.listEbooks(query);
};

export const getEbookById = async (id: string) => {
  const data = await adminEbook.getEbookById(assertEbookSqlId(id, "Ebook"));
  if (!data) throw new HttpError(404, "Ebook not found");
  return data;
};

export const createEbook = async (validated: any) => {
  // PDF-upload status fields are owned by the upload pipeline, not this write path.
  return adminEbook.createEbook(validated);
};

export const updateEbook = async (id: string, validated: any) => {
  // Replaced S3 files are not cleaned up here. PDF-status fields are owned by
  // the upload pipeline.
  const data = await adminEbook.updateEbook(assertEbookSqlId(id, "Ebook"), validated);
  if (!data) throw new HttpError(404, "Ebook not found");
  return data;
};

export const deleteEbook = async (id: string) => {
  // Cascades the ebook's plans (ws_package_course_ebook_price) in one txn; S3 files are not cleaned up.
  const ok = await adminEbook.deleteEbook(assertEbookSqlId(id, "Ebook"));
  if (!ok) throw new HttpError(404, "Ebook not found");
  return;
};

export
 const toggleEbookTrending = async (id: string) => {
  const numId = assertEbookSqlId(id, "Ebook");
  const updated = await adminEbook.toggleEbookTrending(numId);
  if (!updated) throw new HttpError(404, "Ebook not found");
  await invalidateEbookCaches(id);
  return { isTrending: updated.isTrending };
};

export const reorderEbooks = async (orders: Array<{ id: string; order: number }>) => {
  await adminEbook.reorderEbooks(orders);
  return;
};

export const listEbookPlans = async (
  ebookId: string,
  opts: { skip: number; take: number; page: number; limit: number }
) => {
  const res = await adminEbook.listEbookPlans(assertEbookSqlId(ebookId, "Ebook"), opts);
  if (res === "not_found") throw new HttpError(404, "Ebook not found");
  return res;
};

export const createEbookPlan = async (ebookId: string, validated: any) => {
  const res = await adminEbook.createEbookPlan(assertEbookSqlId(ebookId, "Ebook"), validated);
  if (res === "not_found") throw new HttpError(404, "Ebook not found");
  return res;
};

export const getEbookPlanById = async (planId: string) => {
  const plan = await adminEbook.getEbookPlanById(assertEbookSqlId(planId, "Plan"));
  if (!plan) throw new HttpError(404, "Plan not found");
  return plan;
};

export const updateEbookPlan = async (planId: string, validated: any) => {
  const res = await adminEbook.updateEbookPlan(assertEbookSqlId(planId, "Plan"), validated);
  if (res === "not_found") throw new HttpError(404, "Plan not found");
  if (res === "frozen_terms") throw new HttpError(422, PLAN_TERMS_FROZEN_MESSAGE);
  return res;
};

export const deleteEbookPlan = async (planId: string) => {
  const res = await adminEbook.deleteEbookPlan(assertEbookSqlId(planId, "Plan"));
  if (res === "not_found") throw new HttpError(404, "Plan not found");
  if (typeof res === "object") throw new HttpError(409, planInUseMessage(res.inUse));
  return;
};
