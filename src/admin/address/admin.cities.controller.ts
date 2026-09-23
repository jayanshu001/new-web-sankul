/**
 * Admin address "Cities" CRUD — sourced from ws_customer_distict (districts),
 * NOT ws_offline_city. Keeps the exact offline-city request/response contract so
 * the existing admin Cities screen keeps working:
 *   - response DTO: { _id, name, image, status, order, stateId:{_id,name,stateCode}, createdAt, updatedAt }
 *   - list filters: status ("true"/"false"), stateId, search, page/limit
 * Differences forced by the district schema (see FRONTEND notes below):
 *   - `stateId` is REQUIRED on create (district FK is NOT NULL).
 *   - `image` and `order` are accepted but ignored (no district columns) — the
 *     response always returns image:"" and order:0.
 *   - delete is blocked (409) when a customer references the district.
 * Offline-city CRUD (/admin/offline, cart, centers) is untouched.
 */
import { Request, Response } from "express";
import { z } from "zod";
import {
  listCityDistrictsAdmin,
  getCityDistrictAdmin,
  createCityDistrict,
  updateCityDistrict,
  deleteCityDistrict,
} from "../../modules/customer-lookups/customer-lookups.service";

const parseId = (v: string): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// image/order may still be sent by the existing form — z.object strips unknown
// keys, so they are silently ignored rather than rejected.
const cityCreateSchema = z.object({
  name: z.string().min(1).max(100),
  status: z.boolean().optional(),
  stateId: z.coerce.number().int().positive(), // REQUIRED — district FK NOT NULL
});
const cityUpdateSchema = cityCreateSchema.partial();

export const listCities = async (req: Request, res: Response) => {
  try {
    const { status, stateId, search, page, limit } = req.query as Record<string, string>;
    const paginate = page !== undefined || limit !== undefined;
    const pageNum = Math.max(parseInt(page ?? "1", 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit ?? "20", 10) || 20, 1);
    const meta = (total: number) => ({
      total,
      page: paginate ? pageNum : 1,
      limit: paginate ? limitNum : total,
      totalPages: paginate ? Math.ceil(total / limitNum) : 1,
    });

    const st = status === "true" ? true : status === "false" ? false : undefined;
    const stateNum = stateId && Number.isInteger(Number(stateId)) && Number(stateId) > 0 ? Number(stateId) : undefined;
    const { data, total } = await listCityDistrictsAdmin({
      status: st,
      stateId: stateNum,
      search: search?.trim() || undefined,
      skip: paginate ? (pageNum - 1) * limitNum : undefined,
      take: paginate ? limitNum : undefined,
    });
    return res.status(200).json({ success: true, data, pagination: meta(total) });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const getCity = async (req: Request, res: Response) => {
  try {
    const nid = parseId(req.params.id as string);
    if (nid == null) return res.status(400).json({ success: false, message: "Invalid id." });
    const data = await getCityDistrictAdmin(nid);
    if (!data) return res.status(404).json({ success: false, message: "City not found." });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const createCity = async (req: Request, res: Response) => {
  try {
    if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
    const data = cityCreateSchema.parse(req.body);
    const r = await createCityDistrict(data);
    if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
    return res.status(201).json({ success: true, data: r.data });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const updateCity = async (req: Request, res: Response) => {
  try {
    if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
    const nid = parseId(req.params.id as string);
    if (nid == null) return res.status(400).json({ success: false, message: "Invalid id." });
    const data = cityUpdateSchema.parse(req.body);
    const r = await updateCityDistrict(nid, data);
    if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
    return res.status(200).json({ success: true, data: r.data });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const deleteCity = async (req: Request, res: Response) => {
  try {
    const nid = parseId(req.params.id as string);
    if (nid == null) return res.status(400).json({ success: false, message: "Invalid id." });
    const r = await deleteCityDistrict(nid);
    if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
    return res.status(200).json({ success: true, message: "City deleted." });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
