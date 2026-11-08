import { describe, expect, it } from "vitest";
import {
  billDuplicateWarning, billDue, billStatusLabel, bookedWhereLabel, fundFromPayKind, presentBill, resolvePaidCents,
} from "@/domain/incoming-bill";
import { incomingBillSchema } from "@/lib/validation/schemas";

describe("Eingangsrechnung – Status und Herkunft", () => {
  it("unbezahlt bleibt offen und ungebucht", () => {
    expect(resolvePaidCents("UNPAID", 12_000, null)).toBe(0);
    expect(fundFromPayKind("UNPAID")).toBeNull();
    expect(bookedWhereLabel(null, 0)).toBe("Noch nicht gebucht");
    expect(billStatusLabel(12_000, 0)).toMatch(/Noch offen \/ 120,00\s€ fällig/);
    expect(billDue(12_000, 0)).toEqual({ status: "OPEN", dueCents: 12_000, creditCents: 0 });
  });

  it("Bar oder Bank mit vollem Betrag = komplett bezahlt, Herkunft sichtbar", () => {
    expect(resolvePaidCents("CASH", 4_990, null)).toBe(4_990);
    expect(presentBill(4_990, 4_990, "CASH")).toMatchObject({
      status: "PAID", statusLabel: "Komplett bezahlt", bookedLabel: "Ausgabe Kasse (Bar)", bookedWhere: "CASH",
    });
    expect(presentBill(4_990, 4_990, "BANK")).toMatchObject({
      status: "PAID", bookedLabel: "Ausgabe Bankkonto", bookedWhere: "BANK",
    });
  });

  it("Teilzahlung und Guthaben", () => {
    const partial = presentBill(10_000, 4_000, "CASH");
    expect(partial).toMatchObject({
      status: "OPEN", dueCents: 6_000, bookedLabel: "Ausgabe Kasse (Bar)",
    });
    expect(partial.statusLabel).toMatch(/Teilbezahlt – noch 60,00\s€ fällig/);
    const credit = presentBill(10_000, 12_500, "BANK");
    expect(credit).toMatchObject({
      status: "CREDIT", creditCents: 2_500, bookedLabel: "Ausgabe Bankkonto",
    });
    expect(credit.statusLabel).toMatch(/Guthaben vorhanden · 25,00\s€/);
  });

  it("Dublette nur auf demselben Konto", () => {
    const d = new Date("2026-11-07T12:00:00Z");
    expect(billDuplicateWarning("CASH", d, 0, "Metro")).toBeNull();
    expect(billDuplicateWarning("CASH", d, 1, "Metro")).toMatch(/Kasse \(Bar\)/);
    expect(billDuplicateWarning("BANK", d, 1, "Metro")).toMatch(/Bankkonto/);
  });

  it("Zahlungskanal ist Pflicht, bei unbezahlt kein gezahlter Betrag", () => {
    expect(() => incomingBillSchema.parse({ supplier: "Metro", amountCents: "10,00", category: "WAREN" })).toThrow(/bezahlt/);
    expect(incomingBillSchema.parse({
      supplier: "Metro", amountCents: "49,90", payKind: "CASH", category: "WAREN",
    })).toMatchObject({ supplier: "Metro", amountCents: 4_990, payKind: "CASH", paidCents: null });
    expect(() => resolvePaidCents("UNPAID", 100, 50)).toThrow(/Noch nicht bezahlt/);
    expect(() => resolvePaidCents("BANK", 100, 0)).toThrow(/gezahlten Betrag/);
  });

  it("Storno und Löschen ändern die Herkunftsanzeige", () => {
    expect(presentBill(100, 100, "CASH", { reversed: true }).bookedLabel).toBe("Ausgabe Kasse (Bar) · storniert");
    expect(presentBill(100, 100, "CASH", { removed: true }).bookedLabel).toBe("Buchung gelöscht");
  });
});
