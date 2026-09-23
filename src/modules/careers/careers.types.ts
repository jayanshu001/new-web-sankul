export type CareerOpeningJobType = "full_time" | "part_time" | "contract" | "internship";
export type CareerOpeningExperienceLevel = "fresher" | "experienced" | "any";
export type CareerApplicationStatus = "new" | "reviewing" | "shortlisted" | "rejected";

export interface CareerOpeningDto {
  _id: string;
  // Legacy `websankul-jobs`/`websankul-books` careers UI (pre-existing, not
  // rewritten for this migration) reads `id` as a number — kept alongside
  // `_id` (websankul-admin's convention) so neither frontend needs changes.
  id: number;
  title: string;
  department: string | null;
  location: string | null;
  job_type: CareerOpeningJobType;
  experience_level: CareerOpeningExperienceLevel;
  description: string | null;
  requirements: string | null;
  min_salary: number | null;
  max_salary: number | null;
  vacancies: number;
  last_date: Date | null;
  status: number;
  created_at: Date | null;
  updated_at: Date | null;
}

export interface CareerOpeningCreateInput {
  title: string;
  department?: string;
  location?: string;
  jobType?: CareerOpeningJobType;
  experienceLevel?: CareerOpeningExperienceLevel;
  description?: string;
  requirements?: string;
  minSalary?: number;
  maxSalary?: number;
  vacancies?: number;
  lastDate?: Date;
  status?: boolean;
}

export type CareerOpeningUpdateInput = Partial<CareerOpeningCreateInput>;

export interface CareerApplicationDto {
  _id: string;
  id: number;
  opening_id: string | null;
  job_title: string | null;
  full_name: string;
  email: string | null;
  contact_number: string;
  age: string;
  gender: string;
  address: string;
  experience_level: string;
  last_company: string | null;
  current_salary: string | null;
  expected_salary: string;
  reason: string | null;
  resume: string | null;
  status: CareerApplicationStatus;
  created_at: Date | null;
  updated_at: Date | null;
}

// Public apply payload — every value arrives as a string off the legacy form
// contract (`websankul-jobs`/`websankul-books` CareerForm.tsx), stored as-is;
// the underlying columns are VARCHAR too (confirmed via DESCRIBE), not a
// transformer shortcut.
export interface CareerApplicationCreateInput {
  openingId?: bigint | null;
  jobTitle?: string | null;
  fullName: string;
  email?: string | null;
  contactNumber: string;
  age: string;
  gender: string;
  address: string;
  experienceLevel: string;
  lastCompany?: string | null;
  currentSalary?: string | null;
  expectedSalary: string;
  reason?: string | null;
}
