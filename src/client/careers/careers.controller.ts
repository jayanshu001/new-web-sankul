import { Request, Response } from "express";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { success } from "../../utils/httpResponse";
import type { CareerApplicationBody } from "../../modules/careers/careers.validation";
import * as careersService from "../../modules/careers/careers.service";

export const getCurrentOpenings = asyncHandler(async (_req: Request, res: Response) =>
  success(res, { openings: await careersService.listActiveOpenings() })
);

export const applyToOpening = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as CareerApplicationBody;

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
