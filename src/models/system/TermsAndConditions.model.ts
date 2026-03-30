import { Schema, model, Document } from "mongoose";

export interface ITermsAndConditions extends Document {
  module: string;
  terms: string;
  freeShippingMinimumOrderAmount: number;
  status: boolean;
}

const TermsAndConditionsSchema = new Schema<ITermsAndConditions>(
  {
    module: { type: String, required: true },
    terms: { type: String, required: true },
    freeShippingMinimumOrderAmount: { type: Number, required: true },
    status: { type: Boolean, required: true, default: true },
  },
  { collection: "ws_terms_and_conditions", timestamps: false }
);

export const TermsAndConditions = model<ITermsAndConditions>(
  "TermsAndConditions",
  TermsAndConditionsSchema
);
