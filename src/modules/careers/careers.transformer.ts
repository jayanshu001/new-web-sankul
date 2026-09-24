import type { CareerApplication, CareerOpening } from "@prisma/client";
import type { CareerApplicationDto, CareerOpeningDto } from "./careers.types";

const toNumberOrNull = (value: unknown): number | null => (value === null ? null : Number(value));

export const toCareerOpeningDto = (row: CareerOpening): CareerOpeningDto => ({
  _id: String(row.id),
  id: Number(row.id),
  title: row.title,
  department: row.department,
  location: row.location,
  job_type: row.jobType,
  experience_level: row.experienceLevel,
  description: row.description,
  requirements: row.requirements,
  min_salary: toNumberOrNull(row.minSalary),
  max_salary: toNumberOrNull(row.maxSalary),
  vacancies: row.vacancies,
  last_date: row.lastDate,
  status: row.status ? 1 : 0,
  created_at: row.createdAt,
  updated_at: row.updatedAt,
});

export const toCareerApplicationDto = (row: CareerApplication): CareerApplicationDto => ({
  _id: String(row.id),
  id: Number(row.id),
  opening_id: row.openingId === null ? null : String(row.openingId),
  job_title: row.jobTitle,
  full_name: row.fullName,
  email: row.email,
  contact_number: row.contactNumber,
  age: row.age,
  gender: row.gender,
  address: row.address,
  experience_level: row.experienceLevel,
  last_company: row.lastCompany,
  current_salary: row.currentSalary,
  expected_salary: row.expectedSalary,
  reason: row.reason,
  resume: row.resume,
  status: row.status,
  created_at: row.createdAt,
  updated_at: row.updatedAt,
});
