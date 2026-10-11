// Einzelbericht je Mitarbeiter / Gesellschafter: getrennte Personenkonten und Geldtransfers.
//   Budget / Guthaben   walletDeltaCents   (Geld der Firma, das die Person hält)
//   Auslagenkonto       claimDeltaCents    (privat ausgelegt = Verbindlichkeit der Firma an die Person)
//   Kapitalkonto        partnerDeltaCents  (nur Gesellschafter)
import { ACCOUNT_LABEL, type AccountKind } from "./accounts";
import { LEDGER_LABEL, type LedgerType } from "./ledger";
import { formatCents } from "./money";
import { fmtDate } from "./period";

export type PersonRole = "EMPLOYEE" | "PARTNER";
export type PersonAccountKey = "BUDGET" | "OUTLAY" | "CAPITAL";

export interface PersonLedgerRow {
  id: string;
  type: LedgerType;
  reversedType: LedgerType | null;
  reversalOfId: string | null;
  bookingDate: Date;
  cashDeltaCents: number;
  bankDeltaCents: number;
  walletDeltaCents: number;
  claimDeltaCents: number;
  partnerDeltaCents: number;
  accountKind: AccountKind | null;
  description: string | null;
}

export interface ReportLine { label: string; cents: number }

export interface AccountBlock {
  key: PersonAccountKey;
  title: string;
  hint: string;
  openingCents: number;
  lines: ReportLine[];
  inCents: number;
  outCents: number;
  closingCents: number;
  closingLabel: string;
  /** Sicht der Firma: Auslagen sind eine Verbindlichkeit (negativ) */
  firmViewCents: number | null;
  firmViewLabel: string | null;
}

export interface TransferRow {
  id: string;
  date: Date;
  /** aus Sicht der Firma */
  direction: "TO_PERSON" | "FROM_PERSON" | "COMPANY_EXPENSE";
  directionLabel: string;
  account: AccountKind;
  accountLabel: string;
  amountCents: number;
  kind: string;
  purpose: string;
  reversed: boolean;
  isReversal: boolean;
}

export interface MovementRow {
  id: string;
  date: Date;
  kind: string;
  account: PersonAccountKey | null;
  accountLabel: string;
  deltaCents: number;
  balanceAfterCents: number | null;
  via: string | null;
  purpose: string;
  reversed: boolean;
}

export interface PersonReport {
  person: { id: string; name: string; role: PersonRole };
  from: string;
  to: string;
  accounts: AccountBlock[];
  transfers: TransferRow[];
  movements: MovementRow[];
  statements: string[];
}

const effType = (r: PersonLedgerRow): LedgerType => (r.type === "REVERSAL" ? r.reversedType ?? "REVERSAL" : r.type);
const kindLabel = (r: PersonLedgerRow) =>
  r.type === "REVERSAL" && r.reversedType ? `Storno: ${LEDGER_LABEL[r.reversedType]}` : LEDGER_LABEL[r.type];
const z = (v: number) => v + 0;

function sum(rows: PersonLedgerRow[], field: "walletDeltaCents" | "claimDeltaCents" | "partnerDeltaCents",
  types: LedgerType[], account?: AccountKind | "NONE") {
  return z(rows
    .filter((r) => types.includes(effType(r)))
    .filter((r) => account === undefined || (account === "NONE" ? !r.accountKind : r.accountKind === account))
    .reduce((s, r) => s + r[field], 0));
}

function block(
  key: PersonAccountKey, title: string, hint: string, opening: number, lines: ReportLine[], closingLabel: string,
  firm?: { label: string; sign: 1 | -1 },
): AccountBlock {
  const inCents = lines.filter((l) => l.cents > 0).reduce((s, l) => s + l.cents, 0);
  const outCents = -lines.filter((l) => l.cents < 0).reduce((s, l) => s + l.cents, 0);
  const closing = opening + inCents - outCents;
  return {
    key, title, hint, openingCents: opening, lines, inCents, outCents: z(outCents), closingCents: z(closing), closingLabel,
    firmViewCents: firm ? z(firm.sign * closing) : null, firmViewLabel: firm?.label ?? null,
  };
}

/** Konto-Zeilen: nur Kasse/Bank-Varianten mit Bewegung, sonst eine Sammelzeile (lückenlos, auch 0,00 €) */
function split(label: string, field: "walletDeltaCents" | "claimDeltaCents" | "partnerDeltaCents", rows: PersonLedgerRow[], types: LedgerType[]): ReportLine[] {
  const cash = sum(rows, field, types, "CASH");
  const bank = sum(rows, field, types, "BANK");
  const none = sum(rows, field, types, "NONE");
  const out: ReportLine[] = [];
  if (cash) out.push({ label: `${label} – ${ACCOUNT_LABEL.CASH}`, cents: cash });
  if (bank) out.push({ label: `${label} – ${ACCOUNT_LABEL.BANK}`, cents: bank });
  if (none) out.push({ label, cents: none });
  if (!out.length) out.push({ label, cents: 0 });
  return out;
}

export function buildPersonReport(input: {
  person: { id: string; name: string; role: PersonRole };
  from: string; to: string;
  /** chronologisch oder beliebig – wird sortiert */
  rows: PersonLedgerRow[];
  opening: { walletCents: number; claimCents: number; capitalCents: number };
}): PersonReport {
  const { person, opening } = input;
  const rows = [...input.rows].sort((a, b) => a.bookingDate.getTime() - b.bookingDate.getTime());
  const name = person.name;
  const reversedIds = new Set(rows.filter((r) => r.reversalOfId).map((r) => r.reversalOfId!));

  const budget = block("BUDGET", "Budget / Guthaben",
    `Geld der Firma, das ${name} zur Verfügung hat`,
    opening.walletCents,
    [
      ...split("+ Erhalten von der Firma", "walletDeltaCents", rows, ["ALLOCATION"]),
      { label: "− Ausgaben mit Beleg", cents: sum(rows, "walletDeltaCents", ["RECEIPT"]) },
      { label: "− Ausgaben ohne Beleg / Ausgleich", cents: sum(rows, "walletDeltaCents", ["ADJUSTMENT"]) },
      ...split("− An die Firma zurückgegeben", "walletDeltaCents", rows, ["RETURN"]),
    ],
    `Restbetrag bei ${name}`,
  );

  const outlayTypes: LedgerType[] = ["EMPLOYEE_OUTLAY", "PARTNER_OUTLAY"];
  const refundTypes: LedgerType[] = ["OUTLAY_REPAY", "PARTNER_OUTLAY_REFUND"];
  const outlay = block("OUTLAY", "Auslagenkonto (privat ausgelegt)",
    `Offener Anspruch von ${name} gegen die Firma – nie Teil von Kapital oder Budget`,
    opening.claimCents,
    [
      { label: "+ Aus eigener Tasche vorgelegt", cents: sum(rows, "claimDeltaCents", outlayTypes) },
      ...split("− Von der Firma erstattet", "claimDeltaCents", rows, refundTypes),
    ],
    `Offen – Firma schuldet ${name}`,
    { label: "Verbindlichkeit der Firma", sign: -1 },
  );

  const accounts = [budget, outlay];
  if (person.role === "PARTNER") {
    accounts.push(block("CAPITAL", "Kapitalkonto", "Einlagen − Entnahmen + Gewinnanteile",
      opening.capitalCents,
      [
        ...split("+ Einlagen", "partnerDeltaCents", rows, ["PARTNER_DEPOSIT"]),
        ...split("− Entnahmen", "partnerDeltaCents", rows, ["PARTNER_DRAW"]),
        { label: "+ Gewinnanteile", cents: sum(rows, "partnerDeltaCents", ["PARTNER_PROFIT"]) },
      ],
      "Kapitalkonto Ende",
    ));
  }

  const transfers: TransferRow[] = rows
    .filter((r) => r.cashDeltaCents !== 0 || r.bankDeltaCents !== 0)
    .map((r) => {
      const account: AccountKind = r.bankDeltaCents !== 0 ? "BANK" : "CASH";
      const delta = r.cashDeltaCents + r.bankDeltaCents;
      const t = effType(r);
      const direction: TransferRow["direction"] = t === "PARTNER_EXPENSE" ? "COMPANY_EXPENSE" : delta < 0 ? "TO_PERSON" : "FROM_PERSON";
      const fromFirm = delta < 0;
      return {
        id: r.id, date: r.bookingDate, direction,
        directionLabel: direction === "COMPANY_EXPENSE"
          ? `Firmenmittel, ausgegeben von ${name}`
          : fromFirm ? `Firma → ${name}` : `${name} → Firma`,
        account, accountLabel: ACCOUNT_LABEL[account],
        amountCents: Math.abs(delta), kind: kindLabel(r), purpose: r.description ?? "",
        reversed: reversedIds.has(r.id), isReversal: r.type === "REVERSAL",
      };
    });

  const running: Record<PersonAccountKey, number> = {
    BUDGET: opening.walletCents, OUTLAY: opening.claimCents, CAPITAL: opening.capitalCents,
  };
  const label: Record<PersonAccountKey, string> = { BUDGET: "Budget", OUTLAY: "Auslagen", CAPITAL: "Kapital" };
  const movements: MovementRow[] = rows.map((r) => {
    const key: PersonAccountKey | null = r.walletDeltaCents ? "BUDGET" : r.claimDeltaCents ? "OUTLAY" : r.partnerDeltaCents ? "CAPITAL" : null;
    const delta = key === "BUDGET" ? r.walletDeltaCents : key === "OUTLAY" ? r.claimDeltaCents : key === "CAPITAL" ? r.partnerDeltaCents
      : r.cashDeltaCents + r.bankDeltaCents;
    if (key) running[key] += delta;
    const via = r.cashDeltaCents ? ACCOUNT_LABEL.CASH : r.bankDeltaCents ? ACCOUNT_LABEL.BANK : null;
    return {
      id: r.id, date: r.bookingDate, kind: kindLabel(r), account: key,
      accountLabel: key ? label[key] : "Firmenmittel",
      deltaCents: delta, balanceAfterCents: key ? running[key] : null, via, purpose: r.description ?? "",
      reversed: reversedIds.has(r.id),
    };
  });

  const statements: string[] = [];
  const returns = transfers.filter((t) => t.direction === "FROM_PERSON" && t.kind === LEDGER_LABEL.RETURN && !t.reversed);
  if (budget.closingCents > 0) {
    statements.push(`Restguthaben ${formatCents(budget.closingCents)} verbleibt bei ${name} – nicht an die Firma zurücküberwiesen.`);
  } else if (budget.openingCents || budget.inCents || budget.outCents) {
    statements.push(`Budget vollständig abgerechnet – kein Restguthaben bei ${name}.`);
  }
  for (const t of returns) {
    statements.push(`${formatCents(t.amountCents)} am ${fmtDate(t.date)} an die Firma zurückgegeben (${t.accountLabel}).`);
  }
  if (outlay.closingCents > 0) {
    statements.push(`Die Firma schuldet ${name} ${formatCents(outlay.closingCents)} aus privat ausgelegtem Geld (Verbindlichkeit der Firma ${formatCents(-outlay.closingCents)}).`);
  } else if (outlay.inCents || outlay.outCents) {
    statements.push(`Alle Auslagen von ${name} sind erstattet.`);
  }
  if (!statements.length) statements.push(`Keine Bewegungen und keine offenen Beträge für ${name} im Zeitraum.`);

  return { person, from: input.from, to: input.to, accounts, transfers, movements, statements };
}
