// Buchungsregeln: Welche Wirkung hat eine Buchung auf Pool und Wallet?
// Eine zentrale Stelle -> keine Vorzeichenfehler verteilt im Code.

export type LedgerType =
  | "INCOME_INVOICE" | "INCOME_MANUAL" | "ALLOCATION"
  | "RECEIPT" | "ADJUSTMENT" | "RETURN" | "REVERSAL";

export interface Deltas {
  poolDeltaCents: number;
  walletDeltaCents: number;
}

/** amountCents ist immer positiv; das Vorzeichen ergibt sich aus dem Typ. */
export function deltasFor(type: Exclude<LedgerType, "REVERSAL">, amountCents: number): Deltas {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error("Betrag muss eine positive Ganzzahl (Cent) sein");
  }
  switch (type) {
    case "INCOME_INVOICE":
    case "INCOME_MANUAL":
      return { poolDeltaCents: amountCents, walletDeltaCents: 0 };
    case "ALLOCATION":
      return { poolDeltaCents: -amountCents, walletDeltaCents: amountCents };
    case "RECEIPT":
    case "ADJUSTMENT":
      return { poolDeltaCents: 0, walletDeltaCents: -amountCents };
    case "RETURN":
      return { poolDeltaCents: amountCents, walletDeltaCents: -amountCents };
  }
}

/** Storno = exakt negierte Wirkung der Originalbuchung */
export function reversalDeltas(original: Deltas): Deltas {
  return {
    poolDeltaCents: -original.poolDeltaCents,
    walletDeltaCents: -original.walletDeltaCents,
  };
}

/** Typen, die der Admin direkt stornieren darf.
 *  Einnahmen aus Rechnungen -> über Rechnungsstorno,
 *  Belege -> über "Beleg ablehnen". */
export const DIRECTLY_REVERSIBLE: LedgerType[] = ["INCOME_MANUAL", "ALLOCATION", "ADJUSTMENT", "RETURN"];

/** Kein Konto darf negativ werden (Regel 1: kein Minus-Guthaben). */
export function assertNonNegative(balanceAfter: number, msg: string) {
  if (balanceAfter < 0) throw new RangeError(msg);
}

export const LEDGER_LABEL: Record<LedgerType, string> = {
  INCOME_INVOICE: "Einnahme (Rechnung)",
  INCOME_MANUAL: "Einnahme (manuell)",
  ALLOCATION: "Budget-Zuteilung",
  RECEIPT: "Beleg",
  ADJUSTMENT: "Ausgleichsbuchung",
  RETURN: "Rückführung in Pool",
  REVERSAL: "Storno",
};
