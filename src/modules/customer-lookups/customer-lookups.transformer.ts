import type {
  CustomerState,
  CustomerDistict,
  CustomerEducation,
  CustomerTargetGoal,
} from "@prisma/client";
import type {
  StateDto,
  DistrictDto,
  EducationDto,
  TargetGoalDto,
} from "./customer-lookups.types";

export const toStateDto = (row: CustomerState): StateDto => ({
  _id: String(row.id),
  name: row.name,
  stateCode: row.state_code,
  active: row.active,
});

export const toDistrictDto = (row: CustomerDistict): DistrictDto => ({
  _id: String(row.id),
  name: row.name,
  stateId: String(row.stateId),
  active: row.active,
});

export const toEducationDto = (row: CustomerEducation): EducationDto => ({
  _id: String(row.id),
  name: row.name,
  status: row.status,
});

export const toTargetGoalDto = (row: CustomerTargetGoal): TargetGoalDto => ({
  _id: String(row.id),
  name: row.name,
  image: row.image,
  active: row.active,
});
