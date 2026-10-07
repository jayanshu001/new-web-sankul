// Customer lookups: DTO and input types.
export interface StateDto {
  _id: string;
  name: string;
  stateCode: string;
  active: boolean;
}

export interface DistrictDto {
  _id: string;
  name: string;
  stateId: string;
  active: boolean;
}

export interface EducationDto {
  _id: string;
  name: string;
  status: boolean;
}

export interface TargetGoalDto {
  _id: string;
  name: string;
  image: string;
  active: boolean;
}

export interface StateInput {
  name: string;
  stateCode: string;
  active?: boolean;
}
export interface DistrictInput {
  name: string;
  stateId: string;
  active?: boolean;
}
export interface EducationInput {
  name: string;
  status?: boolean;
}
export interface TargetGoalInput {
  name: string;
  image: string;
  active?: boolean;
}
