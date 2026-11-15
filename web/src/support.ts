/**
 * The "Support and partners" page (Faza 24): what it says. It is built only when the SUPPORT variable is set
 * (README → "Podrška i partneri"); until then nothing of it reaches the site.
 *
 * Edit here: a contact address once there is one, a donation page once an association has one, and every
 * partner or funder as they come. The list is public on the page, with the rule that none of them shapes
 * the data.
 */
import { z } from "zod";

export const PARTNER_ROLES = ["funder", "data", "institution"] as const;

const PartnerSchema = z.object({
  name: z.string().min(1),
  url: z.url().nullable(),
  role: z.enum(PARTNER_ROLES),
  /** "2027-01": since when */
  since: z.string().regex(/^\d{4}-\d{2}$/),
});

export const SupportContentSchema = z.object({
  /** where partners and supporters write; null leaves the contact section out */
  contact: z.email().nullable(),
  /** a page where people can donate (an association's); null leaves donations out entirely */
  donate: z.url().nullable(),
  /** newest first */
  partners: z.array(PartnerSchema),
});

export type SupportContent = z.infer<typeof SupportContentSchema>;
export type Partner = z.infer<typeof PartnerSchema>;

export const SUPPORT_CONTENT: SupportContent = SupportContentSchema.parse({
  contact: null,
  donate: null,
  partners: [],
});

/** The switch: "1" or "true" turns the page and its links on; anything else (or nothing) leaves them off. */
export function supportEnabled(value: unknown): boolean {
  return typeof value === "string" && ["1", "true"].includes(value.trim().toLowerCase());
}
