import { Schema, model, Document, Types } from "mongoose";

export interface ICustomerBankAccount extends Document {
  customerId: Types.ObjectId;
  accountHolderName: string;
  ifscCode: string;
  accountNumber: string;
  bankName?: string;
  branchName?: string;
  city?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const CustomerBankAccountSchema = new Schema<ICustomerBankAccount>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    accountHolderName: { type: String, required: true, maxlength: 150 },
    ifscCode: { type: String, required: true, maxlength: 11 },
    accountNumber: { type: String, required: true, maxlength: 18 },
    bankName: { type: String, maxlength: 150 },
    branchName: { type: String, maxlength: 200 },
    city: { type: String, maxlength: 100 },
  },
  { collection: "ws_customer_bank_accounts", timestamps: true }
);

CustomerBankAccountSchema.index({ customerId: 1 });

export const CustomerBankAccount = model<ICustomerBankAccount>(
  "CustomerBankAccount",
  CustomerBankAccountSchema
);
