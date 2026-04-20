import { z } from "zod";

const REFERRAL_CODE_REGEX = /^[A-Z0-9]{8,10}$/;

export const generateReferralCodeSchema = z.object({
  referralCode: z
    .string()
    .regex(REFERRAL_CODE_REGEX, "Referral code must be 8-10 uppercase letters or digits."),
});

export const withdrawRewardsSchema = z.object({
  bankAccountId: z.string().min(1, "bankAccountId is required."),
  amount: z.number().int().positive("Amount must be a positive integer."),
});

export const createBankAccountSchema = z.object({
  accountHolderName: z.string().min(1).max(150),
  ifscCode: z.string().min(1).max(50),
  accountNumber: z.string().min(1).max(50),
});

export const updateBankAccountSchema = createBankAccountSchema.partial();

export const BLACKLISTED_REFERRAL_WORDS = [
  "GPSC", "WEBSANKUL", "PSI", "TALATI", "COSTABLE", "GPSCONLINE",
  "DIWALI", "HOLI", "NAVRATRI", "RASGARBA", "HIND", "HAPPY",
  "AAZADI", "INDEPENDENCE", "REPUBLIC", "FREEDOM", "INDIA", "HINDU",
  "ISLAM", "JEHAD", "PHOBIA", "LOVE", "SEX", "PORN", "HUB", "NOGHTY",
  "FUCK", "FOREPLAY", "BANG", "MALE", "ASS", "HOLE", "ADULT", "HARASS",
  "PLANNER", "PEN", "DRIVE", "BOOK", "WELCOME", "GOOGLE", "FACEBOOK",
  "TWITTER", "INSTAGRAM", "WHATSAPP", "JETHALAL", "FESTIVAL50",
];
