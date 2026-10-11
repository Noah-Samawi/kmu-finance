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
  paymentMethod?: "TRANSFER" | "CASH" | null;
  issuer: {
    legalName: string; street: string; zip: string; city: string;
    taxNumber: string | null; vatId: string | null; iban: string | null; bic: string | null;
    smallBusiness: boolean;
    logoKey?: string | null;
    invoiceFooter?: string | null;
    bankName?: string | null;
    invoiceEmail?: string | null;
    website?: string | null;
  };
  recipient: { name: string; street: string | null; zip: string | null; city: string | null; vatId: string | null };
  items: { position: number; description: string; quantity: string; unit: string; unitPriceCents: number; vatRate: number; lineNetCents: number; lineVatCents: number }[];
  netCents: number;
  vatCents: number;
  grossCents: number;
}

const qtyFmt = (q: string) => Number(q).toLocaleString("de-DE", { maximumFractionDigits: 3 });
const LEFT = 270;
const RIGHT_X = 318;

export async function renderInvoicePdf(d: InvoicePdfData): Promise<Uint8Array> {
  const w = await PdfWriter.create();
  const right = A4.w - MARGIN;
  const contentW = A4.w - 2 * MARGIN;

  if (d.issuer.logoKey?.startsWith("data:image")) {
    try {
      const img = await w.embedImage(d.issuer.logoKey);
      const scale = Math.min(36 / img.height, 100 / img.width);
      w.page.drawImage(img, {
        x: right - img.width * scale, y: A4.h - 38 - img.height * scale,
        width: img.width * scale, height: img.height * scale,
      });
    } catch { /* optional */ }
  }

  w.y = A4.h - 42;
  w.line(d.issuer.legalName, { size: 13, bold: true, width: LEFT });
  w.line(d.issuer.street, { size: 9, width: LEFT });
  w.line(`${d.issuer.zip} ${d.issuer.city}`, { size: 9, width: LEFT });
  if (d.issuer.invoiceEmail) w.line(d.issuer.invoiceEmail, { size: 8, color: [0.35, 0.35, 0.4], width: LEFT });
  if (d.issuer.website) w.line(d.issuer.website, { size: 8, color: [0.35, 0.35, 0.4], width: LEFT });
  w.y -= 16;

  const colTop = w.y;
  w.line("RECHNUNGSEMPFÄNGER", { size: 7, bold: true, color: [0.45, 0.45, 0.48], width: LEFT });
  w.line(d.recipient.name, { size: 10, bold: true, width: LEFT });
  if (d.recipient.street) w.line(d.recipient.street, { size: 10, width: LEFT });
  if (d.recipient.zip || d.recipient.city) {
    w.line(`${d.recipient.zip ?? ""} ${d.recipient.city ?? ""}`.trim(), { size: 10, width: LEFT });
  }
  const leftBottom = w.y;

  w.y = colTop;
  w.text("RECHNUNGSANGABEN", { x: RIGHT_X, size: 7, bold: true, color: [0.45, 0.45, 0.48] });
  w.y -= 12;
  const meta: [string, string][] = [
    ["Rechnungsnummer", d.number ?? "– (Entwurf)"],
    ["Rechnungsdatum", fmtDate(d.issueDate)],
    ["Liefer-/Leistungsdatum", fmtDate(d.serviceDate)],
  ];
  if (!d.isCancellation) meta.push(["Zahlbar bis", fmtDate(d.dueDate)]);
  if (d.issuer.vatId) meta.push(["USt-IdNr.", d.issuer.vatId]);
  if (d.issuer.taxNumber) meta.push(["Steuernummer", d.issuer.taxNumber]);
  for (const [k, v] of meta) {
    w.text(k, { x: RIGHT_X, size: 8, color: [0.4, 0.4, 0.45] });
    w.text(v, { x: RIGHT_X, size: 8, bold: true, align: "right", width: right - RIGHT_X });
    w.y -= 13;
  }
  w.y = Math.min(leftBottom, w.y) - 18;

  const title = d.isCancellation ? "Stornorechnung" : "Rechnung";
  w.line(d.isDraft ? `${title} – ENTWURF` : title, { size: 20, bold: true, width: contentW });
  if (d.isCancellation && d.cancelsNumber) w.line(`Storno zur Rechnung ${d.cancelsNumber}`, { size: 10, width: contentW });
  w.y -= 4;
  w.paragraph(
    d.isCancellation
      ? "Hiermit stornieren wir die nachfolgend aufgeführte Leistung."
      : "Sehr geehrte Damen und Herren,\nfür die erbrachten Leistungen berechnen wir Ihnen wie folgt:",
    contentW,
    { size: 9 },
  );
  w.y -= 8;

  w.tableOpen(
    [
      { title: "POS.", width: 36 },
      { title: "BESCHREIBUNG", width: 210 },
      { title: "MENGE", width: 70, align: "right" },
      { title: "EINZELPREIS", width: 90, align: "right" },
      { title: "BETRAG", width: contentW - 406, align: "right" },
    ],
    d.items.map((i) => [
      String(i.position).padStart(2, "0"),
      i.description,
      `${qtyFmt(i.quantity)} ${i.unit}`,
      formatCents(i.unitPriceCents),
      formatCents(i.lineNetCents),
    ]),
  );
  w.y -= 10;

  const sumRow = (label: string, value: string, bold = false, size = 10) => {
    w.ensureSpace(16);
    w.text(label, { x: RIGHT_X, size, bold });
    w.text(value, { x: RIGHT_X, size, bold, align: "right", width: right - RIGHT_X });
    w.y -= 15;
  };
  sumRow("Summe netto", formatCents(d.netCents));
  if (d.issuer.smallBusiness) {
    w.paragraph("Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.", contentW, { size: 8 });
  } else {
    const br = vatBreakdown(d.items);
    if (!br.length) sumRow("Umsatzsteuer 0 %", formatCents(0));
    else for (const v of br) sumRow(`Umsatzsteuer ${formatVatRate(v.rate)}`, formatCents(v.vat));
  }
  w.hLine(RIGHT_X, right, w.y + 6);
  sumRow("Rechnungsbetrag brutto", formatCents(d.grossCents), true, 12);
  w.y -= 14;

  const payTop = w.y;
  w.line("ZAHLUNGSINFORMATIONEN", { size: 7, bold: true, color: [0.45, 0.45, 0.48], width: LEFT });
  if (d.paymentMethod === "CASH") {
    w.paragraph(`Bitte zahlen Sie ${formatCents(d.grossCents)} bar${d.dueDate ? ` bis zum ${fmtDate(d.dueDate)}` : ""}.`, LEFT, { size: 8 });
  } else {
    w.paragraph(
      `Bitte überweisen Sie den Rechnungsbetrag unter Angabe der Rechnungsnummer ${d.number ?? ""} innerhalb des genannten Zahlungsziels.`,
      LEFT, { size: 8 },
    );
  }
  if (d.notes) w.paragraph(d.notes, LEFT, { size: 8 });
  const leftPay = w.y;

  w.y = payTop;
  w.text("BANKVERBINDUNG", { x: RIGHT_X, size: 7, bold: true, color: [0.45, 0.45, 0.48] });
  w.y -= 12;
  const bankLines: [string, string][] = [
    ["Kontoinhaber", d.issuer.legalName],
    ...(d.issuer.bankName ? [["Bank", d.issuer.bankName] as [string, string]] : []),
    ...(d.issuer.iban ? [["IBAN", d.issuer.iban] as [string, string]] : []),
    ...(d.issuer.bic ? [["BIC", d.issuer.bic] as [string, string]] : []),
    ...(d.number ? [["Verwendungszweck", d.number] as [string, string]] : []),
    ...(d.issuer.invoiceEmail ? [["E-Mail", d.issuer.invoiceEmail] as [string, string]] : []),
    ...(d.issuer.website ? [["Web", d.issuer.website] as [string, string]] : []),
  ];
  for (const [k, v] of bankLines) {
    w.text(k, { x: RIGHT_X, size: 8, color: [0.4, 0.4, 0.45] });
    w.text(v, { x: RIGHT_X, size: 8, bold: true, align: "right", width: right - RIGHT_X });
    w.y -= 12;
  }
  w.y = Math.min(leftPay, w.y) - 8;

  w.footerOnAllPages("", [
    `${d.issuer.legalName} · ${d.issuer.street} · ${d.issuer.zip} ${d.issuer.city}`,
    [d.issuer.taxNumber && `St.-Nr. ${d.issuer.taxNumber}`, d.issuer.vatId && `USt-IdNr. ${d.issuer.vatId}`].filter(Boolean).join(" · "),
    [d.issuer.iban && `IBAN ${d.issuer.iban}`, d.issuer.bic && `BIC ${d.issuer.bic}`, d.issuer.invoiceEmail, d.issuer.website].filter(Boolean).join(" · "),
    d.issuer.invoiceFooter?.replace(/\s+/g, " ").trim() ?? "",
  ].filter(Boolean));
  return w.save();
}
