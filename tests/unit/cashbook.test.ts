import { describe, expect, it } from "vitest";
import { openingFromClosing, withRunningBalance } from "@/domain/cashbook";

describe("cashbook running balance", () => {
  const rows = [
    { id: "b", bookingDate: "2026-01-02", cashDeltaCents: -300, bankDeltaCents: 0 },
    { id: "a", bookingDate: "2026-01-01", cashDeltaCents: 1000, bankDeltaCents: 0 },
    { id: "c", bookingDate: "2026-01-03", cashDeltaCents: 50, bankDeltaCents: 0 },
  ];

  it("sortiert chronologisch und berechnet Lfd. Bestand", () => {
    const lines = withRunningBalance(rows, "CASH", 500);
    expect(lines.map((l) => l.id)).toEqual(["a", "b", "c"]);
    expect(lines.map((l) => l.runningBalanceCents)).toEqual([1500, 1200, 1250]);
    expect(lines[0].incomeCents).toBe(1000);
    expect(lines[1].expenseCents).toBe(300);
  });

  it("leitet Öffnung aus Endbestand ab", () => {
    expect(openingFromClosing(rows, "CASH", 1250)).toBe(500);
  });
});
