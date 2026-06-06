/**
 * Customer lookup/reference tables — stable API shapes (Mongo-compatible).
 *
 * Tables: ws_customer_education, ws_customer_state, ws_customer_distict (legacy
 * typo), ws_customer_target_goal. Field-compatible with Mongo apart from
 * `state_code`↔`stateCode` and the district `state` int FK ↔ Mongo `stateId`
 * ObjectId. Ids are returned as strings to match the Mongo `_id` shape.
 */

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
