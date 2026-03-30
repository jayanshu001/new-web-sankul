import { Schema, model, Document, Types } from "mongoose";

export interface ICustomerBankAccount extends Document {
  customerId: Types.ObjectId;
  accountHolderName: string;
  ifscCode: string;
  accountNumber: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const CustomerBankAccountSchema = new Schema<ICustomerBankAccount>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    accountHolderName: { type: String, required: true, maxlength: 150 },
    ifscCode: { type: String, required: true, maxlength: 50 },
    accountNumber: { type: String, required: true },
  },
  { collection: "ws_customer_bank_accounts", timestamps: true }
);

CustomerBankAccountSchema.index({ customerId: 1 });

export const CustomerBankAccount = model<ICustomerBankAccount>(
  "CustomerBankAccount",
  CustomerBankAccountSchema
);
