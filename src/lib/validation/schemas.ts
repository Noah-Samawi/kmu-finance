import { z } from "zod";
import { parseEuroToCents } from "@/domain/money";
import { ALLOWED_VAT_RATES } from "@/domain/invoice";

// Gemeinsame Zod-Schemas für Client und Server.

/** Betrag als Euro-Eingabe ("12,50") ODER als Cent-Integer -> immer Cent */
export const amountCents = z
  .union([z.number().int(), z.string()])
  .transform((v, ctx) => {
    try {
      return typeof v === "number" ? v : parseEuroToCents(v);
    } catch (e) {
      ctx.addIssue({ code: "custom", message: (e as Error).message });
      return z.NEVER;
    }
  });

export const positiveAmount = amountCents.refine((v) => v > 0, "Betrag muss größer als 0 sein")
  .refine((v) => v <= 1_000_000_000, "Betrag zu hoch (max. 10 Mio. €)");

export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum im Format JJJJ-MM-TT");
const optStr = (max = 200) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

export const passwordSchema = z.string().min(8, "Passwort: mindestens 8 Zeichen").max(200);

export const tenantCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,50}$/, "Slug: 3–50 Zeichen a-z, 0-9, -"),
  legalName: z.string().trim().min(2).max(200),
  street: z.string().trim().min(2).max(200),
  zip: z.string().trim().min(4).max(10),
  city: z.string().trim().min(2).max(100),
  taxNumber: optStr(),
  vatId: optStr(),
  iban: optStr(),
  bic: optStr(),
  smallBusiness: z.boolean().default(false),
  invoicePrefix: z.string().trim().regex(/^[A-Z0-9]{1,6}$/, "Präfix: 1–6 Großbuchstaben/Ziffern").default("RE"),
  defaultPaymentDays: z.number().int().min(0).max(120).default(14),
  admin: z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email(),
    password: passwordSchema,
  }),
});

export const tenantUpdateSchema = tenantCreateSchema
  .omit({ admin: true, slug: true })
  .partial()
  .extend({ status: z.enum(["ACTIVE", "SUSPENDED"]).optional() });

export const employeeCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: passwordSchema,
});

export const employeeUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  isActive: z.boolean().optional(),
  password: passwordSchema.optional(),
});

export const contactSchema = z.object({
  type: z.enum(["CUSTOMER", "SUPPLIER", "BOTH"]).default("CUSTOMER"),
  name: z.string().trim().min(2).max(200),
  email: z.string().trim().toLowerCase().email().optional().nullable().or(z.literal("")).transform((v) => v || null),
  street: optStr(),
  zip: optStr(10),
  city: optStr(100),
  vatId: optStr(30),
  notes: optStr(2000),
});
export const contactUpdateSchema = contactSchema.partial().extend({ archived: z.boolean().optional() });

export const invoiceItemSchema = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.union([z.string(), z.number()]).transform((v) => String(v).replace(",", "."))
    .refine((v) => /^\d+(\.\d{1,3})?$/.test(v) && Number(v) > 0, "Menge > 0, max. 3 Nachkommastellen"),
  unit: z.string().trim().min(1).max(20).default("Stk"),
  unitPriceCents: positiveAmount,
  vatRate: z.number().int().refine((v) => (ALLOWED_VAT_RATES as readonly number[]).includes(v), "USt.-Satz: 0, 7 oder 19 %"),
});

export const invoiceDraftSchema = z.object({
  contactId: z.string().min(1),
  serviceDate: dateStr.optional().nullable(),
  dueDate: dateStr.optional().nullable(),
  notes: optStr(2000),
  items: z.array(invoiceItemSchema).max(200).default([]),
});
export const invoiceDraftUpdateSchema = invoiceDraftSchema.partial();

export const markPaidSchema = z.object({ paidAt: dateStr.optional() });
export const cancelInvoiceSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const incomeSchema = z.object({
  amountCents: positiveAmount,
  description: z.string().trim().min(2).max(300),
  bookingDate: dateStr.optional(),
});

export const allocationSchema = z.object({
  employeeId: z.string().min(1),
  amountCents: positiveAmount,
  description: z.string().trim().max(300).optional().nullable(),
});

export const adjustSchema = z.object({
  toZero: z.boolean().default(false),
  amountCents: positiveAmount.optional(),
  description: z.string().trim().min(3, "Begründung erforderlich").max(300),
}).refine((v) => v.toZero || v.amountCents !== undefined, "Betrag oder 'auf 0 setzen' angeben");

export const returnSchema = z.object({
  all: z.boolean().default(false),
  amountCents: positiveAmount.optional(),
  description: z.string().trim().max(300).optional().nullable(),
}).refine((v) => v.all || v.amountCents !== undefined, "Betrag oder 'alles' angeben");

export const reverseSchema = z.object({ reason: z.string().trim().min(3).max(300) });

export const receiptFieldsSchema = z.object({
  amountCents: positiveAmount,
  merchant: z.string().trim().min(1).max(200),
  description: optStr(500),
  receiptDate: dateStr,
  vatRate: z.coerce.number().int().optional().nullable(),
});

export const reviewSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject"), reason: z.string().trim().min(3).max(300) }),
]);

export const rangeSchema = z.object({
  from: dateStr,
  to: dateStr, // inklusive
  employeeId: z.string().optional(),
});

export const closingSchema = z.object({
  periodType: z.enum(["DAY", "MONTH"]),
  period: z.string(), // "2026-10-06" oder "2026-10"
});
