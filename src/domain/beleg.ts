/** Firmen-Belege (DATEV-ähnlich): Status, Ablageort, Filter. */

export const BELEG_STATUSES = ["INBOX", "FILED", "TRASH"] as const;
export type BelegStatus = (typeof BELEG_STATUSES)[number];

export const BELEG_DOC_TYPES = ["CASH", "INCOMING_INVOICE", "OUTGOING_INVOICE", "OTHER"] as const;
export type BelegDocType = (typeof BELEG_DOC_TYPES)[number];

export const BELEG_DOC_TYPE_LABEL: Record<BelegDocType, string> = {
  CASH: "Kasse",
  INCOMING_INVOICE: "Rechnungseingang",
  OUTGOING_INVOICE: "Rechnungsausgang",
  OTHER: "Sonstige",
};

export const BELEG_STATUS_LABEL: Record<BelegStatus, string> = {
  INBOX: "Posteingang",
  FILED: "Belegablage",
  TRASH: "Papierkorb",
};

export type BelegLine = { amountCents: number; vatRate: number; category?: string | null };

export type BelegPeriodPreset = "week" | "month" | "year" | "custom" | "all";
