import { z } from "zod";
import { SERVICES, STATUSES } from "./constants";
import { normalizePhone } from "./phone";

export { SERVICES, STATUSES, type LeadStatus, type Service } from "./constants";

export const leadSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  phone: z
    .string()
    .max(35)
    .optional()
    .default("")
    .transform((value) => normalizePhone(value)),
  service: z.enum(SERVICES),
  notes: z.string().trim().max(1600).optional().default(""),
  source: z
    .string()
    .trim()
    .toLowerCase()
    .max(80)
    .optional()
    .transform((value) => value || "website"),
  sms_consent: z.boolean().optional().default(false),
  /** Honeypot. Real people never fill it in. */
  website: z.string().max(200).optional().default(""),
  /** Client-generated UUID so retries and double-clicks create one lead. */
  idempotency_key: z.uuid().optional(),
});

export type LeadInput = z.infer<typeof leadSchema>;

export const leadUpdateSchema = z
  .object({
    status: z.enum(STATUSES).optional(),
    estimated_value: z.number().finite().min(0).max(10_000_000).optional(),
  })
  .refine((v) => v.status !== undefined || v.estimated_value !== undefined, {
    message: "Provide a status or an estimated value",
  });

export type LeadUpdate = z.infer<typeof leadUpdateSchema>;

export const surveySchema = z.object({
  rating: z.number().int().min(1).max(5),
  feedback: z.string().trim().max(1200).optional().default(""),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(254),
  password: z.string().min(1).max(512),
});
