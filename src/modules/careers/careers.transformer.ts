import type { CareerApplication, CareerOpening } from "@prisma/client";
import type { CareerApplicationDto, CareerOpeningDto } from "./careers.types";

export const toCareerOpeningDto = (row: CareerOpening): CareerOpeningDto => ({
  _id: String(row.id),
  title: row.title,
  department: row.department,
  location: row.location,
  job_type: row.jobType,
  experience_level: row.experienceLevel,
  description: row.description,
  requirements: row.requirements,
  min_salary: row.minSalary !== null ? Number(row.minSalary) : null,
  max_salary: row.maxSalary !== null ? Number(row.maxSalary) : null,
  vacancies: row.vacancies,
  last_date: row.lastDate,
  status: row.status ? 1 : 0,
  created_at: row.createdAt,
  updated_at: row.updatedAt,
});

export const toCareerApplicationDto = (row: CareerApplication): CareerApplicationDto => ({
  _id: String(row.id),
  opening_id: row.openingId !== null ? String(row.openingId) : null,
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
