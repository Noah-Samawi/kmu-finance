import { A4, MARGIN, PdfWriter } from "./pdf-kit";
import { formatCents, formatVatRate } from "@/domain/money";
import { vatBreakdown } from "@/domain/invoice";
import { fmtDate } from "@/domain/period";

export interface InvoicePdfData {
  number: string | null;
  isDraft: boolean;
  isCancellation: boolean;
  cancelsNumber?: string | null;
  issueDate: Date | null;
  serviceDate: Date | null;
  dueDate: Date | null;
  notes: string | null;
  issuer: {
    legalName: string; street: string; zip: string; city: string;
    taxNumber: string | null; vatId: string | null; iban: string | null; bic: string | null;
    smallBusiness: boolean;
  };
  recipient: { name: string; street: string | null; zip: string | null; city: string | null; vatId: string | null };
  items: { position: number; description: string; quantity: string; unit: string; unitPriceCents: number; vatRate: number; lineNetCents: number; lineVatCents: number }[];
  netCents: number;
  vatCents: number;
  grossCents: number;
}

const qtyFmt = (q: string) => Number(q).toLocaleString("de-DE", { maximumFractionDigits: 3 });

export async function renderInvoicePdf(d: InvoicePdfData): Promise<Uint8Array> {
  const w = await PdfWriter.create();
  const right = A4.w - MARGIN;

  // Absenderzeile + Empfänger
  w.line(`${d.issuer.legalName} · ${d.issuer.street} · ${d.issuer.zip} ${d.issuer.city}`, { size: 7, color: [0.4, 0.4, 0.45] });
  w.y -= 6;
  w.line(d.recipient.name, { size: 11, bold: true });
  if (d.recipient.street) w.line(d.recipient.street, { size: 11 });
  if (d.recipient.zip || d.recipient.city) w.line(`${d.recipient.zip ?? ""} ${d.recipient.city ?? ""}`.trim(), { size: 11 });
  if (d.recipient.vatId) w.line(`USt-IdNr.: ${d.recipient.vatId}`, { size: 9 });

  // Metadaten rechts oben
  const metaTop = A4.h - MARGIN - 10;
  const meta: [string, string][] = [
    ["Rechnungsnr.", d.number ?? "– (Entwurf)"],
    ["Rechnungsdatum", fmtDate(d.issueDate)],
    ["Leistungsdatum", fmtDate(d.serviceDate)],
  ];
  if (!d.isCancellation) meta.push(["Fällig am", fmtDate(d.dueDate)]);
  const saveY = w.y;
  w.y = metaTop;
  for (const [k, v] of meta) {
    w.text(k, { x: 360, size: 9, color: [0.4, 0.4, 0.45] });
    w.text(v, { x: 360, size: 9, bold: true, align: "right", width: right - 360 });
    w.y -= 14;
  }
  w.y = Math.min(saveY, w.y) - 30;

  const title = d.isCancellation ? "Stornorechnung" : "Rechnung";
  w.line(d.isDraft ? `${title} – ENTWURF` : `${title} ${d.number}`, { size: 18, bold: true });
  if (d.isCancellation && d.cancelsNumber) w.line(`Storno zur Rechnung ${d.cancelsNumber}`, { size: 10 });
  w.y -= 8;

  w.table(
    [
      { title: "Pos.", width: 32 },
      { title: "Beschreibung", width: 200 },
      { title: "Menge", width: 60, align: "right" },
      { title: "Einzelpreis", width: 75, align: "right" },
      { title: "USt.", width: 40, align: "right" },
      { title: "Netto", width: 88, align: "right" },
    ],
    d.items.map((i) => [
      String(i.position), i.description, `${qtyFmt(i.quantity)} ${i.unit}`,
      formatCents(i.unitPriceCents), formatVatRate(i.vatRate), formatCents(i.lineNetCents),
    ]),
  );
  w.hr(16);

  // Summenblock
  const sumRow = (label: string, value: string, bold = false) => {
    w.ensureSpace(16);
    w.text(label, { x: 330, size: 10, bold });
    w.text(value, { x: 330, size: 10, bold, align: "right", width: right - 330 });
    w.y -= 15;
  };
  sumRow("Nettobetrag", formatCents(d.netCents));
  if (!d.issuer.smallBusiness) {
    for (const v of vatBreakdown(d.items)) {
      sumRow(`USt. ${formatVatRate(v.rate)} auf ${formatCents(v.net)}`, formatCents(v.vat));
    }
  }
  sumRow("Gesamtbetrag", formatCents(d.grossCents), true);
  w.y -= 10;

  if (d.issuer.smallBusiness) {
    w.paragraph("Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.", A4.w - 2 * MARGIN, { size: 9 });
  }
  if (!d.isCancellation && !d.isDraft && d.dueDate) {
    w.paragraph(
      `Bitte überweisen Sie ${formatCents(d.grossCents)} bis zum ${fmtDate(d.dueDate)} unter Angabe der Rechnungsnummer ${d.number}.`,
      A4.w - 2 * MARGIN, { size: 9 },
    );
  }
  if (d.notes) {
    w.y -= 4;
    w.paragraph(d.notes, A4.w - 2 * MARGIN, { size: 9 });
  }

  const bank = [d.issuer.iban && `IBAN ${d.issuer.iban}`, d.issuer.bic && `BIC ${d.issuer.bic}`].filter(Boolean).join(" · ");
  const tax = [d.issuer.taxNumber && `St.-Nr. ${d.issuer.taxNumber}`, d.issuer.vatId && `USt-IdNr. ${d.issuer.vatId}`].filter(Boolean).join(" · ");
  w.footerOnAllPages([d.issuer.legalName, tax, bank].filter(Boolean).join("   ·   "));
  return w.save();
}
