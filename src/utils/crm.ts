import logger from "./logger";
import { CRM_LEAD_TYPE } from "../models/enums";

export interface GenerateCRMLeadArgs {
  params: { userId: string; courseId: string };
  leadType: CRM_LEAD_TYPE;
}

export async function GenerateCRMLead(args: GenerateCRMLeadArgs): Promise<void> {
  logger.info("GenerateCRMLead (stub)", {
    leadType: args.leadType,
    userId: args.params.userId,
    courseId: args.params.courseId,
  });
}
