/** DATEV-Kassenbuch: Einnahme/Ausgabe und laufender Bestand je Zeile. */

export type CashbookDeltaRow = {
  id: string;
  bookingDate: Date | string;
  cashDeltaCents: number;
  bankDeltaCents: number;
};

export type CashbookAccount = "CASH" | "BANK" | "BOTH";

export function accountDelta(r: CashbookDeltaRow, account: CashbookAccount): number {
  if (account === "CASH") return r.cashDeltaCents;
  if (account === "BANK") return r.bankDeltaCents;
  return r.cashDeltaCents + r.bankDeltaCents;
}

/** Chronologisch aufsteigend sortieren (für korrekten Lfd. Bestand). */
export function sortCashbookAsc<T extends CashbookDeltaRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ta = new Date(a.bookingDate).getTime();
    const tb = new Date(b.bookingDate).getTime();
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Öffnungsbestand + Zeilen → Lfd. Bestand nach jeder Bewegung.
 * `closingCents` = Bestand nach der letzten Zeile (sollte dem aktuellen Konto entsprechen).
 */
export function withRunningBalance<T extends CashbookDeltaRow>(
  rows: T[],
  account: CashbookAccount,
  openingCents: number,
): (T & { incomeCents: number; expenseCents: number; runningBalanceCents: number; deltaCents: number })[] {
  const asc = sortCashbookAsc(rows);
  let bal = openingCents;
  return asc.map((r) => {
    const delta = accountDelta(r, account);
    bal += delta;
    return {
      ...r,
      deltaCents: delta,
      incomeCents: delta > 0 ? delta : 0,
      expenseCents: delta < 0 ? -delta : 0,
      runningBalanceCents: bal,
    };
  });
}

/** Öffnung so wählen, dass die letzte Zeile auf `closingCents` landet. */
export function openingFromClosing<T extends CashbookDeltaRow>(
  rows: T[],
  account: CashbookAccount,
  closingCents: number,
): number {
  const sum = rows.reduce((s, r) => s + accountDelta(r, account), 0);
  return closingCents - sum;
}
