import type { AccountKind } from "./accounts";
import { rule } from "./errors";

export type LedgerType =
  | "INCOME_INVOICE" | "INCOME_MANUAL" | "ALLOCATION"
  | "RECEIPT" | "ADJUSTMENT" | "RETURN" | "REVERSAL"
  | "CASH_WITHDRAWAL" | "ACCOUNT_ADJUST"
  | "EMPLOYEE_OUTLAY" | "OUTLAY_REPAY"
  | "PARTNER_DEPOSIT" | "PARTNER_DRAW" | "PARTNER_PROFIT"
  | "PARTNER_OUTLAY" | "PARTNER_OUTLAY_REFUND" | "PARTNER_EXPENSE"
  | "EXPENSE";

export interface Deltas {
  poolDeltaCents: number;
  walletDeltaCents: number;
  cashDeltaCents: number;
  bankDeltaCents: number;
  claimDeltaCents: number;
  partnerDeltaCents: number;
  accountKind?: AccountKind | null;
}

function splitPool(amount: number, account: AccountKind): Pick<Deltas, "cashDeltaCents" | "bankDeltaCents" | "poolDeltaCents"> {
  return {
    cashDeltaCents: account === "CASH" ? amount : 0,
    bankDeltaCents: account === "BANK" ? amount : 0,
    poolDeltaCents: amount,
  };
}

const zero = { walletDeltaCents: 0, claimDeltaCents: 0, partnerDeltaCents: 0 };

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
      return { ...zero, ...splitPool(amountCents, account), accountKind: account };
    case "ALLOCATION":
      return { ...zero, ...splitPool(-amountCents, account), walletDeltaCents: amountCents, accountKind: account };
    case "RECEIPT":
    case "ADJUSTMENT":
      return { ...zero, poolDeltaCents: 0, cashDeltaCents: 0, bankDeltaCents: 0, walletDeltaCents: -amountCents };
    case "RETURN":
      return { ...zero, ...splitPool(amountCents, account), walletDeltaCents: -amountCents, accountKind: account };
    case "CASH_WITHDRAWAL":
      return {
        ...zero, poolDeltaCents: 0, cashDeltaCents: amountCents, bankDeltaCents: -amountCents, accountKind: "BANK",
      };
    case "ACCOUNT_ADJUST":
      return { ...zero, ...splitPool(amountCents, account), accountKind: account };
    case "EMPLOYEE_OUTLAY":
      return { ...zero, poolDeltaCents: 0, cashDeltaCents: 0, bankDeltaCents: 0, claimDeltaCents: amountCents };
    case "OUTLAY_REPAY":
      return { ...zero, ...splitPool(-amountCents, account), claimDeltaCents: -amountCents, accountKind: account };
    case "PARTNER_DEPOSIT":
      return { ...zero, ...splitPool(amountCents, account), partnerDeltaCents: amountCents, accountKind: account };
    case "PARTNER_DRAW":
      return { ...zero, ...splitPool(-amountCents, account), partnerDeltaCents: -amountCents, accountKind: account };
    case "PARTNER_PROFIT":
      return { ...zero, ...splitPool(-amountCents, account), partnerDeltaCents: amountCents, accountKind: account };
    case "PARTNER_OUTLAY":
      return { ...zero, poolDeltaCents: 0, cashDeltaCents: 0, bankDeltaCents: 0, claimDeltaCents: amountCents };
    case "PARTNER_OUTLAY_REFUND":
      return { ...zero, ...splitPool(-amountCents, account), claimDeltaCents: -amountCents, accountKind: account };
    case "PARTNER_EXPENSE":
    case "EXPENSE":
      return { ...zero, ...splitPool(-amountCents, account), accountKind: account };
  }
}

export function reversalDeltas(original: Deltas): Deltas {
  return {
    poolDeltaCents: -original.poolDeltaCents,
    walletDeltaCents: -original.walletDeltaCents,
    cashDeltaCents: -(original.cashDeltaCents ?? 0),
    bankDeltaCents: -(original.bankDeltaCents ?? 0),
    claimDeltaCents: -(original.claimDeltaCents ?? 0),
    partnerDeltaCents: -(original.partnerDeltaCents ?? 0),
    accountKind: original.accountKind ?? null,
  };
}

export const DIRECTLY_REVERSIBLE: LedgerType[] = [
  "INCOME_MANUAL", "ALLOCATION", "ADJUSTMENT", "RETURN", "CASH_WITHDRAWAL", "ACCOUNT_ADJUST",
  "EMPLOYEE_OUTLAY", "OUTLAY_REPAY", "PARTNER_DEPOSIT", "PARTNER_DRAW", "PARTNER_PROFIT",
  "PARTNER_OUTLAY", "PARTNER_OUTLAY_REFUND", "PARTNER_EXPENSE", "EXPENSE",
];

type DeltaKey = "poolDeltaCents" | "walletDeltaCents" | "cashDeltaCents" | "bankDeltaCents" | "claimDeltaCents" | "partnerDeltaCents";
const DELTA_KEYS: DeltaKey[] = ["poolDeltaCents", "walletDeltaCents", "cashDeltaCents", "bankDeltaCents", "claimDeltaCents", "partnerDeltaCents"];

/** Betrag einer Buchung = größte Kontowirkung (alle Teilwirkungen sind ±Betrag oder 0) */
export function entryAmount(e: Deltas): number {
  return Math.max(...DELTA_KEYS.map((k) => Math.abs(e[k] ?? 0)));
}

/**
 * Ändern einer Buchung: alle Kontowirkungen mit dem neuen Betrag (gleiche Vorzeichen, gleiche Konten).
 * Nur möglich, wenn jede Teilwirkung genau ±Betrag ist (bei allen Standard-Buchungsarten der Fall).
 */
export function rescaleDeltas(e: Deltas, newAmountCents: number): Deltas {
  if (!Number.isInteger(newAmountCents) || newAmountCents <= 0) throw rule("Neuer Betrag muss größer als 0 sein");
  const old = entryAmount(e);
  if (!old || DELTA_KEYS.some((k) => (e[k] ?? 0) !== 0 && Math.abs(e[k] ?? 0) !== old)) {
    throw rule("Diese Buchung lässt sich nicht im Betrag ändern – bitte stornieren und neu erfassen");
  }
  const out = { accountKind: e.accountKind ?? null } as Deltas;
  for (const k of DELTA_KEYS) out[k] = Math.sign(e[k] ?? 0) * newAmountCents + 0;
  return out;
}

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
  EMPLOYEE_OUTLAY: "Auslage (privates Geld)",
  OUTLAY_REPAY: "Auslagen-Erstattung",
  PARTNER_DEPOSIT: "Gesellschafter-Einlage",
  PARTNER_DRAW: "Gesellschafter-Entnahme",
  PARTNER_PROFIT: "Gewinnanteil",
  PARTNER_OUTLAY: "Vorgelegtes Geld (Gesellschafter)",
  PARTNER_OUTLAY_REFUND: "Auslagen-Erstattung (Gesellschafter)",
  PARTNER_EXPENSE: "Ausgabe Gesellschafter (Firmenmittel)",
  EXPENSE: "Betriebsausgabe",
};
