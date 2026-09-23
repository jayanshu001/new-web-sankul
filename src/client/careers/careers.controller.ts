import { Request, Response } from "express";
import type { z } from "zod";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { success } from "../../utils/httpResponse";
import type { applicationCreateSchema } from "../../modules/careers/careers.validation";
import * as careersService from "../../modules/careers/careers.service";

type ApplicationCreateBody = z.infer<typeof applicationCreateSchema>;

// GET /api/v1/client/careers/current-openings — PUBLIC, active openings only.
export const getCurrentOpenings = asyncHandler(async (_req: Request, res: Response) => {
  const openings = await careersService.listActiveOpenings();
  return success(res, { openings });
});

// POST /api/v1/client/careers/apply — PUBLIC, no account required.
// `validate({ body: applicationCreateSchema })` on the route has already
// parsed + coerced req.body by the time this runs.
export const applyToOpening = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as ApplicationCreateBody;

  const application = await careersService.submitApplication({
    openingId: body.opening_id ?? undefined,
    jobTitle: body.job_title ?? undefined,
    fullName: body.full_name,
    email: body.email || undefined,
    contactNumber: body.contact_number,
    age: body.age,
    gender: body.gender,
    address: body.address,
    experienceLevel: body.experience_level,
    lastCompany: body.last_company ?? undefined,
    currentSalary: body.current_salary || undefined,
    expectedSalary: body.expected_salary,
    reason: body.reason ?? undefined,
  });

  return success(res, { application }, "Application submitted successfully.", 201);
});
