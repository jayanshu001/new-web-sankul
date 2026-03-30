import { Schema, model, Document } from "mongoose";

export interface ICustomerTargetGoal extends Document {
  name: string;
  image: string;
  active: boolean;
}

const CustomerTargetGoalSchema = new Schema<ICustomerTargetGoal>(
  {
    name: { type: String, required: true, maxlength: 255 },
    image: { type: String, required: true },
    active: { type: Boolean, required: true, default: true },
  },
  { collection: "ws_customer_target_goals", timestamps: false }
);

export const CustomerTargetGoal = model<ICustomerTargetGoal>(
  "CustomerTargetGoal",
  CustomerTargetGoalSchema
);
