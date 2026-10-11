import type { AccountKind } from "./accounts";

export type LedgerType =
  | "INCOME_INVOICE" | "INCOME_MANUAL" | "ALLOCATION"
  | "RECEIPT" | "ADJUSTMENT" | "RETURN" | "REVERSAL"
  | "CASH_WITHDRAWAL" | "ACCOUNT_ADJUST";

export interface Deltas {
  poolDeltaCents: number;
  walletDeltaCents: number;
  cashDeltaCents: number;
  bankDeltaCents: number;
  accountKind?: AccountKind | null;
}

function splitPool(amount: number, account: AccountKind): Pick<Deltas, "cashDeltaCents" | "bankDeltaCents" | "poolDeltaCents"> {
  return {
    cashDeltaCents: account === "CASH" ? amount : 0,
    bankDeltaCents: account === "BANK" ? amount : 0,
    poolDeltaCents: amount,
  };
}

/** amountCents ist immer positiv; das Vorzeichen ergibt sich aus dem Typ. */
export function deltasFor(
  type: Exclude<LedgerType, "REVERSAL">,
  amountCents: number,
  account: AccountKind = "CASH",
): Deltas {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error("Betrag muss eine positive Ganzzahl (Cent) sein");
  }
  switch (type) {
    case "INCOME_INVOICE":
    case "INCOME_MANUAL":
      return { ...splitPool(amountCents, account), walletDeltaCents: 0, accountKind: account };
    case "ALLOCATION":
      return { ...splitPool(-amountCents, account), walletDeltaCents: amountCents, accountKind: account };
    case "RECEIPT":
    case "ADJUSTMENT":
      return { poolDeltaCents: 0, cashDeltaCents: 0, bankDeltaCents: 0, walletDeltaCents: -amountCents };
    case "RETURN":
      return { ...splitPool(amountCents, account), walletDeltaCents: -amountCents, accountKind: account };
    case "CASH_WITHDRAWAL":
      return {
        poolDeltaCents: 0,
        cashDeltaCents: amountCents,
        bankDeltaCents: -amountCents,
        walletDeltaCents: 0,
        accountKind: "BANK",
      };
    case "ACCOUNT_ADJUST":
      return { ...splitPool(amountCents, account), walletDeltaCents: 0, accountKind: account };
  }
}

/** Storno = exakt negierte Wirkung der Originalbuchung */
export function reversalDeltas(original: Deltas): Deltas {
  return {
    poolDeltaCents: -original.poolDeltaCents,
    walletDeltaCents: -original.walletDeltaCents,
    cashDeltaCents: -(original.cashDeltaCents ?? 0),
    bankDeltaCents: -(original.bankDeltaCents ?? 0),
    accountKind: original.accountKind ?? null,
  };
}

export const DIRECTLY_REVERSIBLE: LedgerType[] = [
  "INCOME_MANUAL", "ALLOCATION", "ADJUSTMENT", "RETURN", "CASH_WITHDRAWAL", "ACCOUNT_ADJUST",
];

export function assertNonNegative(balanceAfter: number, msg: string) {
  if (balanceAfter < 0) throw new RangeError(msg);
}

export const LEDGER_LABEL: Record<LedgerType, string> = {
  INCOME_INVOICE: "Einnahme (Rechnung)",
  INCOME_MANUAL: "Einnahme (manuell)",
  ALLOCATION: "Budget-Zuteilung",
  RECEIPT: "Beleg",
  ADJUSTMENT: "Ausgleichsbuchung",
  RETURN: "Rückführung",
  REVERSAL: "Storno",
  CASH_WITHDRAWAL: "Geldtransit Bank → Kasse",
  ACCOUNT_ADJUST: "Kontokorrektur",
};
