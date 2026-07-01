/**
 * Customer-master lookups — MySQL (Prisma) branch. Wave 8.
 *
 * Gated behind `isMysqlModule("customer-master")`. Four flat lookup tables —
 * CustomerState, CustomerDistrict, CustomerEducation, CustomerTargetGoal — each
 * a trivial admin CRUD with NO new DDL (the Prisma models already exist). The
 * legacy `src/admin/customer-master/customer-master.controller.ts` branches each
 * handler on `isCustomerMasterMysql()` and delegates here.
 *
 * DTOs mirror the Mongo response shape (`_id` string, same keys) so the admin UI
 * is unchanged. Field drift vs Mongo: SQL state uses `state_code` (Mongo
 * `stateCode`), district FK is `stateId`→`state` col, education uses `status`
 * (others `active`), target-goal has a required `image` (defaulted to "").
 */
import { prisma } from "../../config/prisma";
import { parseLabels } from "../../utils/goalSelection";

export const CUSTOMER_MASTER_MODULE = "customer-master";
export const isCustomerMasterMysql = (): boolean => true;

/** Parse a string id to a positive int, else null. */
export const parseId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

type Envelope<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

// ─── States ─────────────────────────────────────────────────────────────────────
const stateDto = (s: any) => ({ _id: String(s.id), name: s.name, stateCode: s.state_code, active: s.active });

export const listStates = async (opts?: {
  active?: boolean;
  search?: string;
  skip?: number;
  take?: number;
}): Promise<{ data: any[]; total: number }> => {
  const where: any = {};
  if (opts?.active !== undefined) where.active = opts.active;
  if (opts?.search) where.OR = [{ name: { contains: opts.search } }, { state_code: { contains: opts.search } }];
  const [rows, total] = await Promise.all([
    prisma.customerState.findMany({
      where,
      orderBy: { id: "desc" }, // newest first (ws_customer_state has no created_at column)
      skip: opts?.skip,
      take: opts?.take,
    }),
    prisma.customerState.count({ where }),
  ]);
  return { data: rows.map(stateDto), total };
};

export const createState = async (input: { name: string; stateCode: string; active: boolean }) => {
  const row = await prisma.customerState.create({
    data: { name: input.name, state_code: input.stateCode, active: input.active },
  });
  return stateDto(row);
};

export const updateState = async (
  id: number,
  input: { name?: string; stateCode?: string; active?: boolean }
): Promise<Envelope<any>> => {
  const exists = await prisma.customerState.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return { ok: false, status: 404, message: "State not found" };
  const data: any = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.stateCode !== undefined) data.state_code = input.stateCode;
  if (input.active !== undefined) data.active = input.active;
  const row = await prisma.customerState.update({ where: { id }, data });
  return { ok: true, data: stateDto(row) };
};

export const deleteState = async (id: number): Promise<Envelope<null>> => {
  const exists = await prisma.customerState.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return { ok: false, status: 404, message: "State not found" };
  await prisma.customerState.delete({ where: { id } });
  return { ok: true, data: null };
};

// ─── Districts ──────────────────────────────────────────────────────────────────
const districtDto = (d: any) => ({
  _id: String(d.id),
  name: d.name,
  active: d.active,
  // populated state (matches Mongo's .populate("stateId", "_id name stateCode"))
  stateId: d.state ? { _id: String(d.state.id), name: d.state.name, stateCode: d.state.state_code } : (d.stateId != null ? String(d.stateId) : null),
});

export const listDistricts = async (filter: { stateId?: number; active?: boolean }) => {
  const where: any = {};
  if (filter.stateId !== undefined) where.stateId = filter.stateId;
  if (filter.active !== undefined) where.active = filter.active;
  const rows = await prisma.customerDistict.findMany({
    where,
    include: { state: { select: { id: true, name: true, state_code: true } } },
    orderBy: { name: "asc" },
  });
  return rows.map(districtDto);
};

export const createDistrict = async (input: {
  name: string; stateId: number; active: boolean;
}): Promise<Envelope<any>> => {
  const state = await prisma.customerState.findUnique({ where: { id: input.stateId }, select: { id: true } });
  if (!state) return { ok: false, status: 404, message: "State not found" };
  const row = await prisma.customerDistict.create({
    data: { name: input.name, stateId: input.stateId, active: input.active },
    include: { state: { select: { id: true, name: true, state_code: true } } },
  });
  return { ok: true, data: districtDto(row) };
};

export const updateDistrict = async (
  id: number,
  input: { name?: string; stateId?: number; active?: boolean }
): Promise<Envelope<any>> => {
  const exists = await prisma.customerDistict.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return { ok: false, status: 404, message: "District not found" };
  if (input.stateId !== undefined) {
    const state = await prisma.customerState.findUnique({ where: { id: input.stateId }, select: { id: true } });
    if (!state) return { ok: false, status: 404, message: "State not found" };
  }
  const data: any = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.stateId !== undefined) data.stateId = input.stateId;
  if (input.active !== undefined) data.active = input.active;
  const row = await prisma.customerDistict.update({
    where: { id }, data,
    include: { state: { select: { id: true, name: true, state_code: true } } },
  });
  return { ok: true, data: districtDto(row) };
};

export const deleteDistrict = async (id: number): Promise<Envelope<null>> => {
  const exists = await prisma.customerDistict.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return { ok: false, status: 404, message: "District not found" };
  await prisma.customerDistict.delete({ where: { id } });
  return { ok: true, data: null };
};

// ─── Educations ─────────────────────────────────────────────────────────────────
const educationDto = (e: any) => ({ _id: String(e.id), name: e.name, status: e.status });

export const listEducations = async (status?: boolean) => {
  const rows = await prisma.customerEducation.findMany({
    where: status === undefined ? {} : { status },
    orderBy: { name: "asc" },
  });
  return rows.map(educationDto);
};

export const createEducation = async (input: { name: string; status: boolean }) => {
  const row = await prisma.customerEducation.create({ data: { name: input.name, status: input.status } });
  return educationDto(row);
};

export const updateEducation = async (
  id: number, input: { name?: string; status?: boolean }
): Promise<Envelope<any>> => {
  const exists = await prisma.customerEducation.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return { ok: false, status: 404, message: "Education not found" };
  const data: any = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.status !== undefined) data.status = input.status;
  const row = await prisma.customerEducation.update({ where: { id }, data });
  return { ok: true, data: educationDto(row) };
};

export const deleteEducation = async (id: number): Promise<Envelope<null>> => {
  const exists = await prisma.customerEducation.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return { ok: false, status: 404, message: "Education not found" };
  await prisma.customerEducation.delete({ where: { id } });
  return { ok: true, data: null };
};

// ─── Target Goals ───────────────────────────────────────────────────────────────
const goalDto = (g: any) => ({
  _id: String(g.id),
  name: g.name,
  image: g.image,
  active: g.active,
  labels: parseLabels(g.labels).map((l) => ({ _id: String(l.id), name: l.name })),
});

/**
 * Assign stable numeric ids to a target goal's labels (stored in the `labels`
 * JSON). On update an existing label keeps its id (matched by name); new labels
 * get the next free id. (Same stable-id scheme the retired ws_goal admin used.)
 */
const withLabelIds = (
  labels: { name: string }[],
  existing?: unknown
): { id: number; name: string }[] => {
  const prior = parseLabels(existing);
  const idByName = new Map<string, number>();
  for (const l of prior) idByName.set(l.name, l.id);
  let next = Math.max(0, ...prior.map((l) => l.id)) + 1;
  return labels.map((l) => ({ id: idByName.get(l.name) ?? next++, name: l.name }));
};

export const listTargetGoals = async (active?: boolean) => {
  const rows = await prisma.customerTargetGoal.findMany({
    where: active === undefined ? {} : { active },
    orderBy: { name: "asc" },
  });
  return rows.map(goalDto);
};

export const createTargetGoal = async (input: { name: string; image: string; active: boolean; labels?: { name: string }[] }) => {
  const row = await prisma.customerTargetGoal.create({
    data: {
      name: input.name,
      image: input.image ?? "",
      active: input.active,
      labels: (input.labels ? withLabelIds(input.labels) : []) as any,
    },
  });
  return goalDto(row);
};

export const updateTargetGoal = async (
  id: number, input: { name?: string; image?: string; active?: boolean; labels?: { name: string }[] }
): Promise<Envelope<any>> => {
  const exists = await prisma.customerTargetGoal.findUnique({ where: { id }, select: { id: true, labels: true } });
  if (!exists) return { ok: false, status: 404, message: "Target Goal not found" };
  const data: any = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.image !== undefined) data.image = input.image;
  if (input.active !== undefined) data.active = input.active;
  if (input.labels !== undefined) data.labels = withLabelIds(input.labels, exists.labels) as any;
  const row = await prisma.customerTargetGoal.update({ where: { id }, data });
  return { ok: true, data: goalDto(row) };
};

export const deleteTargetGoal = async (id: number): Promise<Envelope<null>> => {
  const exists = await prisma.customerTargetGoal.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return { ok: false, status: 404, message: "Target Goal not found" };
  await prisma.customerTargetGoal.delete({ where: { id } });
  return { ok: true, data: null };
};
