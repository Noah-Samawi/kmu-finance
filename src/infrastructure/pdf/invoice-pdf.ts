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
    tagline?: string | null;
    ownerName?: string | null;
  };
  recipient: { name: string; street: string | null; zip: string | null; city: string | null; vatId: string | null };
  items: { position: number; description: string; quantity: string; unit: string; unitPriceCents: number; vatRate: number; lineNetCents: number; lineVatCents: number }[];
  netCents: number;
  vatCents: number;
  grossCents: number;
}

const qtyFmt = (q: string) => Number(q).toLocaleString("de-DE", { maximumFractionDigits: 3 });
const GRAY: [number, number, number] = [0.42, 0.42, 0.45];
const INK: [number, number, number] = [0.07, 0.07, 0.08];
const BORDER: [number, number, number] = [0.72, 0.72, 0.74];

export async function renderInvoicePdf(d: InvoicePdfData): Promise<Uint8Array> {
  const w = await PdfWriter.create();
  const left = MARGIN;
  const right = A4.w - MARGIN;
  const contentW = right - left;
  const iss = d.issuer;

  // ── Briefkopf: Absender oben links, Logo oben rechts ──
  const top = A4.h - 50;
  const logoW = 150;
  let logoBottom = top;
  if (iss.logoKey?.startsWith("data:image")) {
    try {
      const img = await w.embedImage(iss.logoKey);
      const scale = Math.min(56 / img.height, logoW / img.width);
      const h = img.height * scale;
      w.page.drawImage(img, { x: right - img.width * scale, y: top - h, width: img.width * scale, height: h });
      logoBottom = top - h;
    } catch { /* Logo optional */ }
  }
  const senderW = contentW - logoW - 20;
  w.y = top - 18;
  for (const l of w.wrap(iss.legalName.toLocaleUpperCase("de-DE"), senderW, 20, { face: "serif", bold: true })) {
    w.text(l, { x: left, size: 20, face: "serif", bold: true, color: INK });
    w.y -= 22;
  }
  if (iss.tagline) {
    w.text(w.fit(iss.tagline.toLocaleUpperCase("de-DE"), senderW, 7), { x: left, size: 7, color: GRAY });
    w.y -= 13;
  }
  const senderLines = [
    iss.ownerName ? `Inhaber: ${iss.ownerName}` : null,
    iss.street,
    `${iss.zip} ${iss.city}`,
    [iss.invoiceEmail, iss.website].filter(Boolean).join(" · ") || null,
  ].filter((x): x is string => !!x);
  for (const l of senderLines) {
    w.text(w.fit(l, senderW, 8.5), { x: left, size: 8.5, color: INK });
    w.y -= 11.5;
  }
  w.y = Math.min(w.y + 4, logoBottom - 6);
  w.hLine(left, right, w.y, 1.3, [0.12, 0.12, 0.13]);
  w.y -= 18;

  // ── Kasten: Empfänger | Rechnungsangaben ──
  const mid = left + contentW * 0.51;
  const recLines = [
    d.recipient.name,
    d.recipient.street,
    [d.recipient.zip, d.recipient.city].filter(Boolean).join(" "),
    d.recipient.vatId ? `USt-IdNr.: ${d.recipient.vatId}` : null,
  ].filter((x): x is string => !!x);
  const meta: [string, string][] = [
    [d.isCancellation ? "Stornonummer" : "Rechnungsnummer", d.number ?? "– (Entwurf)"],
    ["Rechnungsdatum", fmtDate(d.issueDate)],
    ["Leistungsdatum", fmtDate(d.serviceDate)],
  ];
  if (!d.isCancellation && d.dueDate) meta.push(["Zahlbar bis", fmtDate(d.dueDate)]);
  if (iss.vatId) meta.push(["USt-IdNr.", iss.vatId]);
  if (iss.taxNumber) meta.push(["Steuernummer", iss.taxNumber]);
  const rowH = 13;
  const boxTop = w.y;
  const boxH = 44 + Math.max(recLines.length, meta.length) * rowH;
  w.strokeRect(left, boxTop - boxH, contentW, boxH, 0.6, undefined, BORDER);
  w.vLine(mid, boxTop, boxTop - boxH, 0.6, BORDER);
  w.drawAt(w.page, "RECHNUNGSEMPFÄNGER", left + 10, boxTop - 16, { size: 6.8, bold: true, color: GRAY });
  w.drawAt(w.page, "RECHNUNGSANGABEN", mid + 10, boxTop - 16, { size: 6.8, bold: true, color: GRAY });
  recLines.forEach((l, i) => {
    w.drawAt(w.page, w.fit(l, mid - left - 20, 9), left + 10, boxTop - 40 - i * rowH, { size: 9, color: INK });
  });
  meta.forEach(([k, v], i) => {
    const y = boxTop - 40 - i * rowH;
    const lw = w.drawAt(w.page, `${k}: `, mid + 10, y, { size: 8.5, bold: true, color: INK });
    w.drawAt(w.page, w.fit(v, right - mid - 20 - lw, 8.5), mid + 10 + lw, y, { size: 8.5, color: INK });
  });
  w.y = boxTop - boxH - 40;

  // ── Titel + Anrede ──
  const title = d.isCancellation ? "Stornorechnung" : "Rechnung";
  w.text(d.isDraft ? `${title} – Entwurf` : title, { x: left, size: 24, face: "serif", bold: true, color: INK });
  w.y -= 22;
  if (d.isCancellation && d.cancelsNumber) w.line(`Storno zur Rechnung ${d.cancelsNumber}`, { size: 9, width: contentW });
  w.paragraph(
    d.isCancellation
      ? "Hiermit stornieren wir die nachfolgend aufgeführten Leistungen."
      : "Sehr geehrte Damen und Herren,\nfür die erbrachten Leistungen berechnen wir Ihnen wie folgt:",
    contentW,
    { size: 8.8, color: INK },
  );
  w.y -= 8;

  // ── Positionstabelle ──
  const cols = [
    { title: "POS.", width: 40 },
    { title: "BESCHREIBUNG", width: 223 },
    { title: "MENGE", width: 75, align: "right" as const },
    { title: "EINZELPREIS", width: 78 },
    { title: "BETRAG", width: contentW - 416 },
  ].map((c, i) => (i >= 3 ? { ...c, align: "right" as const } : c));
  w.gridTable(cols, d.items.map((i) => {
    const [head, ...rest] = i.description.split("\n");
    const sub = rest.join(" ").trim();
    return [
      { parts: [{ text: String(i.position).padStart(2, "0") }] },
      { parts: [{ text: head, bold: true }, ...(sub ? [{ text: sub }] : [])] },
      { parts: [{ text: `${qtyFmt(i.quantity)} ${i.unit}`.trim() }] },
      { parts: [{ text: formatCents(i.unitPriceCents) }] },
      { parts: [{ text: formatCents(i.lineNetCents) }] },
    ];
  }), { size: 8.6 });
  w.y -= 24;

  // ── Summenblock: Summe Netto · MwSt. X % · Rechnungsbetrag brutto ──
  const sx = left + contentW * 0.465;
  const sumRows: [string, string][] = [["Summe netto", formatCents(d.netCents)]];
  if (d.issuer.smallBusiness) sumRows.push(["MwSt. 0 % (§ 19 UStG)", formatCents(0)]);
  else {
    const br = vatBreakdown(d.items);
    if (!br.length) sumRows.push(["MwSt. 0 %", formatCents(0)]);
    for (const v of br) sumRows.push([`MwSt. ${formatVatRate(v.rate)}`, formatCents(v.vat)]);
  }
  w.ensureSpace(sumRows.length * 24 + 40);
  for (const [k, v] of sumRows) {
    w.text(k, { x: sx + 6, size: 8.8, color: INK });
    w.text(v, { x: sx, width: contentW - (sx - left) - 6, align: "right", size: 8.8, color: INK });
    w.y -= 10;
    w.hLine(sx, right, w.y, 0.5, BORDER);
    w.y -= 14;
  }
  w.y += 10;
  w.hLine(sx, right, w.y, 1.3, INK);
  w.y -= 18;
  w.text("Rechnungsbetrag brutto", { x: sx + 6, size: 8.8, bold: true, color: INK });
  w.text(formatCents(d.grossCents), { x: sx, width: contentW - (sx - left) - 6, align: "right", size: 14, face: "serif", bold: true, color: INK });
  w.y -= 34;

  // ── Zahlungsinformationen (grauer Kasten, volle Bankverbindung) ──
  const cash = d.paymentMethod === "CASH";
  const payCells: [string, string][][] = cash
    ? [[["Zahlungsart", "Barzahlung"], ["Betrag", formatCents(d.grossCents)], ["Fällig bis", fmtDate(d.dueDate)]]]
    : [
        [["Kontoinhaber", iss.legalName], ["IBAN", iss.iban ?? "–"], ["Verwendungszweck", d.number ?? "–"]],
        [["Bank", iss.bankName ?? "–"], ["BIC", iss.bic ?? "–"], ["Zahlbar bis", fmtDate(d.dueDate)]],
      ];
  const payH = 14 + payCells.length * 30;
  w.ensureSpace(payH + 70);
  w.text("ZAHLUNGSINFORMATIONEN", { x: left, size: 6.8, bold: true, color: GRAY });
  w.y -= 10;
  const payTop = w.y;
  w.strokeRect(left, payTop - payH, contentW, payH, 0.6, [0.95, 0.95, 0.95], BORDER);
  const colW = [contentW * 0.35, contentW * 0.4, contentW * 0.25];
  payCells.forEach((row, ri) => {
    let x = left + 10;
    row.forEach(([k, v], ci) => {
      const y = payTop - 18 - ri * 30;
      w.drawAt(w.page, k, x, y, { size: 8.5, bold: true, color: INK });
      w.drawAt(w.page, w.fit(v, colW[ci] - 14, 8.5), x, y - 12, { size: 8.5, color: INK });
      x += colW[ci];
    });
  });
  w.y = payTop - payH - 18;
  w.paragraph(
    cash
      ? `Bitte zahlen Sie den Rechnungsbetrag von ${formatCents(d.grossCents)} bar${d.dueDate ? ` bis zum ${fmtDate(d.dueDate)}` : ""}. Vielen Dank für Ihren Auftrag.`
      : "Bitte überweisen Sie den Rechnungsbetrag unter Angabe der Rechnungsnummer innerhalb des genannten Zahlungsziels. Vielen Dank für Ihren Auftrag.",
    contentW, { size: 8.8, color: INK },
  );
  if (d.notes) {
    w.y -= 4;
    w.paragraph(d.notes, contentW, { size: 8.5, color: INK });
  }

  // ── Fußzeile: Anschrift, Steuer, Bank, Kontakt ──
  w.footerOnAllPages("", [
    [iss.legalName, iss.ownerName && `Inhaber: ${iss.ownerName}`, iss.street, `${iss.zip} ${iss.city}`].filter(Boolean).join(" · "),
    [iss.taxNumber && `Steuernummer ${iss.taxNumber}`, iss.vatId && `USt-IdNr. ${iss.vatId}`, iss.invoiceEmail, iss.website].filter(Boolean).join(" · "),
    [iss.bankName, iss.iban && `IBAN ${iss.iban}`, iss.bic && `BIC ${iss.bic}`].filter(Boolean).join(" · "),
    iss.invoiceFooter?.replace(/\s+/g, " ").trim() ?? "",
  ].filter(Boolean));
  return w.save();
}
