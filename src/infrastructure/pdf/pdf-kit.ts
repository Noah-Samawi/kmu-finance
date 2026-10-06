import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";

// Kleine Hilfsschicht über pdf-lib: Seitenumbruch, Text, Tabellen.
// Standardschriften (WinAnsi) unterstützen Umlaute, ß und €.

export const A4 = { w: 595.28, h: 841.89 };
export const MARGIN = 50;

export class PdfWriter {
  doc!: PDFDocument;
  page!: PDFPage;
  font!: PDFFont;
  bold!: PDFFont;
  y = 0;
  private charset!: Set<number>;

  static async create() {
    const w = new PdfWriter();
    w.doc = await PDFDocument.create();
    w.font = await w.doc.embedFont(StandardFonts.Helvetica);
    w.bold = await w.doc.embedFont(StandardFonts.HelveticaBold);
    w.charset = new Set(w.font.getCharacterSet());
    w.newPage();
    return w;
  }

  newPage() {
    this.page = this.doc.addPage([A4.w, A4.h]);
    this.y = A4.h - MARGIN;
  }

  /** Zeichen, die die Standardschrift nicht kennt, werden ersetzt statt abzustürzen */
  clean(text: string) {
    return [...text.replace(/\t/g, " ")].map((c) => (this.charset.has(c.codePointAt(0)!) ? c : "?")).join("");
  }

  ensureSpace(h: number) {
    if (this.y - h < MARGIN + 20) this.newPage();
  }

  text(t: string, opts: { x?: number; size?: number; bold?: boolean; color?: [number, number, number]; align?: "left" | "right"; width?: number } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const s = this.clean(t);
    let x = opts.x ?? MARGIN;
    if (opts.align === "right") x = x + (opts.width ?? 0) - font.widthOfTextAtSize(s, size);
    this.page.drawText(s, { x, y: this.y, size, font, color: rgb(...(opts.color ?? [0.1, 0.1, 0.12])) });
  }

  line(text: string, opts: Parameters<PdfWriter["text"]>[1] = {}) {
    const size = opts.size ?? 10;
    this.ensureSpace(size + 4);
    this.text(text, opts);
    this.y -= size + 4;
  }

  /** Mehrzeiliger Text mit Zeilenumbruch */
  paragraph(text: string, width: number, opts: { x?: number; size?: number } = {}) {
    const size = opts.size ?? 10;
    for (const l of this.wrap(text, width, size)) this.line(l, { x: opts.x, size });
  }

  wrap(text: string, width: number, size: number, font = this.font): string[] {
    const out: string[] = [];
    for (const para of this.clean(text).split("\n")) {
      let cur = "";
      for (const word of para.split(" ")) {
        const test = cur ? `${cur} ${word}` : word;
        if (font.widthOfTextAtSize(test, size) > width && cur) {
          out.push(cur);
          cur = word;
        } else cur = test;
      }
      out.push(cur);
    }
    return out;
  }

  /**
   * Trennlinie. this.y ist immer die Grundlinie der NÄCHSTEN Textzeile;
   * die Linie liegt knapp darüber, danach rückt y um eine Zeile nach unten,
   * damit Großbuchstaben der Folgezeile die Linie nicht berühren.
   */
  hr(after = 12) {
    this.ensureSpace(after + 4);
    const lineY = this.y + 2;
    this.page.drawLine({
      start: { x: MARGIN, y: lineY }, end: { x: A4.w - MARGIN, y: lineY },
      thickness: 0.5, color: rgb(0.75, 0.75, 0.78),
    });
    this.y -= after;
  }

  /** Tabelle mit Kopfzeile, wiederholt den Kopf nach Seitenumbruch */
  table(cols: { title: string; width: number; align?: "left" | "right" }[], rows: string[][], size = 9) {
    const rowH = size + 6;
    const drawHeader = () => {
      let x = MARGIN;
      for (const c of cols) {
        this.text(c.title, { x, size, bold: true, align: c.align, width: c.width - 4 });
        x += c.width;
      }
      this.y -= rowH - 2;
      this.hr(13);
    };
    this.ensureSpace(rowH * 3);
    drawHeader();
    for (const r of rows) {
      const wrapped = r.map((cell, i) => (cols[i].align === "right" ? [this.clean(cell)] : this.wrap(cell, cols[i].width - 6, size)));
      const lines = Math.max(...wrapped.map((w) => w.length));
      if (this.y - rowH * lines < MARGIN + 20) {
        this.newPage();
        drawHeader();
      }
      for (let li = 0; li < lines; li++) {
        let x = MARGIN;
        cols.forEach((c, i) => {
          const t = wrapped[i][li];
          if (t) this.text(t, { x, size, align: c.align, width: c.width - 4 });
          x += c.width;
        });
        this.y -= rowH;
      }
    }
  }

  footerOnAllPages(text: string) {
    const pages = this.doc.getPages();
    pages.forEach((p, i) => {
      const t = this.clean(`${text}   ·   Seite ${i + 1} / ${pages.length}`);
      p.drawText(t, { x: MARGIN, y: 25, size: 7, font: this.font, color: rgb(0.45, 0.45, 0.5) });
    });
  }

  save() {
    return this.doc.save();
  }
}
