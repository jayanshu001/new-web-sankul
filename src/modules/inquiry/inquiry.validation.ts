import { z } from "zod";

const COURSES = ["UPSC", "GPSC", "STI", "DYSO", "RFO", "PI", "PSI", "Constable", "CCE", "Talati", "Forest", "TET_TAT", "FHW_MPHW"] as const;

// The web form sends display labels ("TET TAT", "FHW MPHW"); the DB enum uses underscores.
const course = z.preprocess((v) => (typeof v === "string" ? v.trim().replace(/\s+/g, "_") : v), z.enum(COURSES));

export const publicEnquirySchema = z.object({
  name: z.string().trim().min(1).max(255),
  mobile: z.string().trim().min(6).max(20),
  email: z.string().trim().email().max(255).optional().or(z.literal("")),
  city: z.string().trim().min(1).max(255),
  mode: z.enum(["online", "offline"]),
  course,
});

export type PublicEnquiryInput = z.infer<typeof publicEnquirySchema>;
