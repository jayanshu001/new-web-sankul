export const CAREER_JOB_TYPE = {
  FULL_TIME: "full_time",
  PART_TIME: "part_time",
  CONTRACT: "contract",
  INTERNSHIP: "internship",
} as const;

export type CareerOpeningJobType = (typeof CAREER_JOB_TYPE)[keyof typeof CAREER_JOB_TYPE];

export const CAREER_JOB_TYPES = Object.values(CAREER_JOB_TYPE) as [
  CareerOpeningJobType,
  ...CareerOpeningJobType[],
];

export const CAREER_EXPERIENCE_LEVEL = {
  FRESHER: "fresher",
  EXPERIENCED: "experienced",
  ANY: "any",
} as const;

export type CareerOpeningExperienceLevel =
  (typeof CAREER_EXPERIENCE_LEVEL)[keyof typeof CAREER_EXPERIENCE_LEVEL];

export const CAREER_EXPERIENCE_LEVELS = Object.values(CAREER_EXPERIENCE_LEVEL) as [
  CareerOpeningExperienceLevel,
  ...CareerOpeningExperienceLevel[],
];

export const CAREER_APPLICATION_STATUS = {
  NEW: "new",
  REVIEWING: "reviewing",
  SHORTLISTED: "shortlisted",
  REJECTED: "rejected",
} as const;

export type CareerApplicationStatus =
  (typeof CAREER_APPLICATION_STATUS)[keyof typeof CAREER_APPLICATION_STATUS];

export const CAREER_APPLICATION_STATUSES = Object.values(CAREER_APPLICATION_STATUS) as [
  CareerApplicationStatus,
  ...CareerApplicationStatus[],
];

export const APPLICANT_GENDER = {
  MALE: "male",
  FEMALE: "female",
} as const;

export type ApplicantGender = (typeof APPLICANT_GENDER)[keyof typeof APPLICANT_GENDER];

export const APPLICANT_GENDERS = Object.values(APPLICANT_GENDER) as [
  ApplicantGender,
  ...ApplicantGender[],
];

export const APPLICANT_EXPERIENCE = {
  FRESHER: "fresher",
  EXPERIENCED: "experienced",
} as const;

export type ApplicantExperience = (typeof APPLICANT_EXPERIENCE)[keyof typeof APPLICANT_EXPERIENCE];

export const APPLICANT_EXPERIENCES = Object.values(APPLICANT_EXPERIENCE) as [
  ApplicantExperience,
  ...ApplicantExperience[],
];

export const DEFAULT_JOB_TYPE: CareerOpeningJobType = CAREER_JOB_TYPE.FULL_TIME;
export const DEFAULT_EXPERIENCE_LEVEL: CareerOpeningExperienceLevel = CAREER_EXPERIENCE_LEVEL.ANY;
export const DEFAULT_VACANCIES = 1;

export const OPENING_SEARCH_FIELDS = ["title", "department", "location"] as const;

export interface PagedResult<T> {
  items: T[];
  total: number;
}

export interface CareerOpeningDto {
  _id: string;
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

export interface CareerOpeningFilter {
  search?: string;
  status?: boolean;
}

export interface CareerOpeningListParams extends CareerOpeningFilter {
  skip: number;
  take: number;
}

export interface CareerApplicationFilter {
  openingId?: bigint;
  status?: CareerApplicationStatus;
}

export interface CareerApplicationListParams extends CareerApplicationFilter {
  skip: number;
  take: number;
}
