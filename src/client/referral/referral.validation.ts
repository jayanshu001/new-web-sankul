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

export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_NUMBER_REGEX = /^\d{9,18}$/;

export const createBankAccountSchema = z
  .object({
    accountHolderName: z.string().trim().min(1).max(150),
    ifscCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(IFSC_REGEX, "IFSC must be 11 chars: 4 letters + 0 + 6 alphanumerics."),
    accountNumber: z
      .string()
      .trim()
      .regex(ACCOUNT_NUMBER_REGEX, "Account number must be 9-18 digits."),
    confirmAccountNumber: z.string().trim(),
  })
  .refine((d) => d.accountNumber === d.confirmAccountNumber, {
    message: "Account numbers do not match.",
    path: ["confirmAccountNumber"],
  });

export const updateBankAccountSchema = z
  .object({
    accountHolderName: z.string().trim().min(1).max(150).optional(),
    ifscCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(IFSC_REGEX, "IFSC must be 11 chars: 4 letters + 0 + 6 alphanumerics.")
      .optional(),
    accountNumber: z
      .string()
      .trim()
      .regex(ACCOUNT_NUMBER_REGEX, "Account number must be 9-18 digits.")
      .optional(),
    confirmAccountNumber: z.string().trim().optional(),
  })
  .refine(
    (d) =>
      d.accountNumber === undefined ||
      d.confirmAccountNumber === undefined ||
      d.accountNumber === d.confirmAccountNumber,
    { message: "Account numbers do not match.", path: ["confirmAccountNumber"] }
  );

export const BLACKLISTED_REFERRAL_WORDS = [
  "GPSC", "WEBSANKUL", "PSI", "TALATI", "COSTABLE", "GPSCONLINE",
  "DIWALI", "HOLI", "NAVRATRI", "RASGARBA", "HIND", "HAPPY",
  "AAZADI", "INDEPENDENCE", "REPUBLIC", "FREEDOM", "INDIA", "HINDU",
  "ISLAM", "JEHAD", "PHOBIA", "LOVE", "SEX", "PORN", "HUB", "NOGHTY",
  "FUCK", "FOREPLAY", "BANG", "MALE", "ASS", "HOLE", "ADULT", "HARASS",
  "PLANNER", "PEN", "DRIVE", "BOOK", "WELCOME", "GOOGLE", "FACEBOOK",
  "TWITTER", "INSTAGRAM", "WHATSAPP", "JETHALAL", "FESTIVAL50",
];
