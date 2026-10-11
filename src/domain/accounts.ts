export type AccountKind = "CASH" | "BANK";

export const ACCOUNT_LABEL: Record<AccountKind, string> = {
  CASH: "Kasse (Bar)",
  BANK: "Bankkonto",
};

export function parseAccountKind(v: unknown, fallback: AccountKind = "CASH"): AccountKind {
  return v === "BANK" || v === "CASH" ? v : fallback;
}
