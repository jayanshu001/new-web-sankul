import { Schema, model, Document, Types } from "mongoose";
import { OsType } from "../enums";

export interface ICustomer extends Document {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  phoneNumber: string;
  emailAddress?: string;
  password?: string;
  isPhoneVerified: boolean;
  otp?: string;
  otpExpiresAt?: Date;
  triedOtp: number;
  otpBlockedAt?: Date;
  profilePicture?: string;
  phone2?: string;
  dob?: Date;
  gender?: string;
  stateId?: Types.ObjectId;
  districtId?: Types.ObjectId;
  city?: string;
  educationId?: Types.ObjectId;
  language?: string;
  goals: Types.ObjectId[];
  referralCode?: string;
  rewardPoints?: number;
  verified: boolean;
  firebaseTokens?: Array<{ token: string; platform?: string; updatedAt: Date }>;
  osType: OsType;
  lastLoginDate?: Date;
  lastLoginIp?: string;
  loginCount?: number;
  isLoggedIn?: boolean;
  isAccountDeleted: boolean;
  status: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const CustomerSchema = new Schema<ICustomer>(
  {
    firstName: { type: String, maxlength: 100 },
    middleName: { type: String, maxlength: 100 },
    lastName: { type: String, maxlength: 100 },
    phoneNumber: { type: String, required: true, unique: true, maxlength: 11 },
    emailAddress: { type: String, maxlength: 255 },
    password: { type: String, maxlength: 255, select: false },
    isPhoneVerified: { type: Boolean, required: true, default: false },
    otp: { type: String, maxlength: 6, select: false },
    otpExpiresAt: { type: Date },
    triedOtp: { type: Number, required: true, default: 0 },
    otpBlockedAt: { type: Date },
    profilePicture: { type: String, maxlength: 255 },
    phone2: { type: String, maxlength: 11 },
    dob: { type: Date },
    gender: { type: String, maxlength: 10 },
    stateId: { type: Schema.Types.ObjectId, ref: "CustomerState" },
    districtId: { type: Schema.Types.ObjectId, ref: "CustomerDistrict" },
    city: { type: String, maxlength: 255 },
    educationId: { type: Schema.Types.ObjectId, ref: "CustomerEducation" },
    language: { type: String, maxlength: 50 },
    goals: [{ type: Schema.Types.ObjectId, ref: "CustomerTargetGoal" }],
    referralCode: { type: String },
    rewardPoints: { type: Number, default: 0 },
    verified: { type: Boolean, required: true, default: false },
    firebaseTokens: {
      type: [
        {
          _id: false,
          token: { type: String, required: true },
          platform: { type: String },
          updatedAt: { type: Date, default: () => new Date() },
        },
      ],
      default: [],
    },
    osType: {
      type: String,
      enum: Object.values(OsType),
      default: OsType.ANDROID,
    },
    lastLoginDate: { type: Date },
    lastLoginIp: { type: String, maxlength: 255 },
    loginCount: { type: Number, default: 0 },
    isLoggedIn: { type: Boolean, default: false },
    isAccountDeleted: { type: Boolean, required: true, default: false },
    status: { type: Boolean, required: true, default: true },
  },
  { collection: "ws_customers", timestamps: true }
);

// Indexes for performance
CustomerSchema.index({ status: 1, isAccountDeleted: 1 });
CustomerSchema.index({ referralCode: 1 }, { unique: true, sparse: true });
CustomerSchema.index({ "firebaseTokens.token": 1 }, { sparse: true });
CustomerSchema.index({ osType: 1, "firebaseTokens.token": 1 });

export const Customer = model<ICustomer>("Customer", CustomerSchema);
