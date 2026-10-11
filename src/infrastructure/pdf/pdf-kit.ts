import { readFileSync } from "node:fs";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";

// Hilfsschicht über pdf-lib: Seitenumbruch, Text, Tabellen.
// Lateinische Texte nutzen die Standardschriften (WinAnsi: Umlaute, ß, €).
// Alles andere – v. a. Arabisch – wird automatisch mit der eingebetteten
// Unicode-Schrift (IBM Plex Sans Arabic, OFL) gesetzt; fontkit übernimmt
// die arabische Glyphenformung, die Lauf-Reihenfolge wird hier per RTL bestimmt.

export const A4 = { w: 595.28, h: 841.89 };
export const MARGIN = 50;

export type FontFace = "sans" | "serif" | "mono";
type RGB = [number, number, number];

export interface TextOpts {
  x?: number;
  size?: number;
  bold?: boolean;
  face?: FontFace;
  color?: RGB;
  align?: "left" | "right" | "center";
  width?: number;
}

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
let fontCache: { regular: Uint8Array; bold: Uint8Array; coverage: Set<number> } | null = null;
function unicodeFontBytes() {
  if (!fontCache) {
    const regular = readFileSync(path.join(FONT_DIR, "IBMPlexSansArabic-Regular.ttf"));
    fontCache = {
      regular,
      bold: readFileSync(path.join(FONT_DIR, "IBMPlexSansArabic-Bold.ttf")),
      coverage: new Set(fontkit.create(regular).characterSet),
    };
  }
  return fontCache;
}

const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

export const hasArabic = (s: string) => ARABIC.test(s);

interface Run { text: string; font: PDFFont }

export class PdfWriter {
  doc!: PDFDocument;
  page!: PDFPage;
  font!: PDFFont;
  bold!: PDFFont;
  y = 0;
  private faces!: Record<FontFace, { regular: PDFFont; bold: PDFFont }>;
  private uni!: { regular: PDFFont; bold: PDFFont };
  private winAnsi!: Set<number>;

  static async create() {
    const w = new PdfWriter();
    w.doc = await PDFDocument.create();
    w.doc.registerFontkit(fontkit);
    const std = (n: StandardFonts) => w.doc.embedFont(n);
    w.faces = {
      sans: { regular: await std(StandardFonts.Helvetica), bold: await std(StandardFonts.HelveticaBold) },
      serif: { regular: await std(StandardFonts.TimesRoman), bold: await std(StandardFonts.TimesRomanBold) },
      mono: { regular: await std(StandardFonts.Courier), bold: await std(StandardFonts.CourierBold) },
    };
    const bytes = unicodeFontBytes();
    w.uni = {
      regular: await w.doc.embedFont(bytes.regular, { subset: true }),
      bold: await w.doc.embedFont(bytes.bold, { subset: true }),
    };
    w.font = w.faces.sans.regular;
    w.bold = w.faces.sans.bold;
    w.winAnsi = new Set(w.font.getCharacterSet());
    w.newPage();
    return w;
  }

  newPage() {
    this.page = this.doc.addPage([A4.w, A4.h]);
    this.y = A4.h - MARGIN;
  }

  /** Nur Tabs/Steuerzeichen normalisieren – Unicode bleibt erhalten. */
  clean(text: string) {
    return text.replace(/\t/g, " ").replace(/[\u0000-\u0008\u000B-\u001F\u200E\u200F]/g, "");
  }

  private stdFont(opts: { bold?: boolean; face?: FontFace }) {
    const f = this.faces[opts.face ?? "sans"];
    return opts.bold ? f.bold : f.regular;
  }

  /**
   * Zerlegt eine Zeile in Schrift-Läufe in visueller Reihenfolge.
   * Grundrichtung = Richtung des ersten starken Zeichens (vereinfachter UBA).
   */
  runs(text: string, opts: { bold?: boolean; face?: FontFace } = {}): Run[] {
    const chars = [...this.clean(text)];
    if (!chars.length) return [];
    const std = this.stdFont(opts);
    const uni = opts.bold ? this.uni.bold : this.uni.regular;
    if (!chars.some((c) => ARABIC.test(c) || !this.winAnsi.has(c.codePointAt(0)!))) {
      return [{ text: chars.join(""), font: std }];
    }

    type Cls = "A" | "L" | "N";
    const cls: Cls[] = chars.map((c) => (ARABIC.test(c) ? "A" : LETTER_OR_DIGIT.test(c) ? "L" : "N"));
    const firstStrong = cls.find((c) => c !== "N") ?? "L";
    const rtl = firstStrong === "A";
    // Neutrale Zeichen übernehmen die Richtung ihrer Nachbarn, sonst die Grundrichtung.
    for (let i = 0; i < cls.length; i++) {
      if (cls[i] !== "N") continue;
      let p = i - 1; while (p >= 0 && cls[p] === "N") p--;
      let n = i + 1; while (n < cls.length && cls[n] === "N") n++;
      const prev = p >= 0 ? cls[p] : firstStrong;
      const next = n < cls.length ? cls[n] : firstStrong;
      cls[i] = prev === next ? prev : rtl ? "A" : "L";
    }

    const groups: { rtl: boolean; chars: string[] }[] = [];
    chars.forEach((c, i) => {
      const isA = cls[i] === "A";
      const g = groups[groups.length - 1];
      if (g && g.rtl === isA) g.chars.push(c);
      else groups.push({ rtl: isA, chars: [c] });
    });
    if (rtl) groups.reverse();

    const out: Run[] = [];
    const push = (t: string, font: PDFFont) => {
      const last = out[out.length - 1];
      if (last && last.font === font) last.text += t;
      else out.push({ text: t, font });
    };
    for (const g of groups) {
      if (g.rtl) {
        // Arabischer Lauf: komplett an fontkit übergeben (Formung + Umkehrung)
        out.push({ text: g.chars.map((c) => (this.uniHas(c.codePointAt(0)!) ? c : "?")).join(""), font: uni });
        continue;
      }
      for (const c of g.chars) {
        const cp = c.codePointAt(0)!;
        if (this.winAnsi.has(cp)) push(c, std);
        else push(this.uniHas(cp) ? c : "?", this.uniHas(cp) ? uni : std);
      }
    }
    return out;
  }

  private uniHas(cp: number) {
    return cp === 0x20 || unicodeFontBytes().coverage.has(cp);
  }

  measure(text: string, size: number, opts: { bold?: boolean; face?: FontFace } = {}) {
    return this.runs(text, opts).reduce((s, r) => s + r.font.widthOfTextAtSize(r.text, size), 0);
  }

  /** Text an absoluter Position zeichnen (Seite optional), ohne this.y zu verändern. */
  drawAt(page: PDFPage, t: string, x: number, y: number, opts: TextOpts = {}) {
    const size = opts.size ?? 10;
    const runs = this.runs(t, opts);
    const total = runs.reduce((s, r) => s + r.font.widthOfTextAtSize(r.text, size), 0);
    let cx = x;
    if (opts.align === "right") cx = x + (opts.width ?? 0) - total;
    else if (opts.align === "center") cx = x + ((opts.width ?? 0) - total) / 2;
    const color = rgb(...(opts.color ?? [0.1, 0.1, 0.12]));
    for (const r of runs) {
      page.drawText(r.text, { x: cx, y, size, font: r.font, color });
      cx += r.font.widthOfTextAtSize(r.text, size);
    }
    return total;
  }

  text(t: string, opts: TextOpts = {}) {
    return this.drawAt(this.page, t, opts.x ?? MARGIN, this.y, opts);
  }

  /** Text, der in die Breite passt (kürzt mit …, nie überlappend). */
  fit(t: string, width: number, size: number, opts: { bold?: boolean; face?: FontFace } = {}) {
    if (this.measure(t, size, opts) <= width) return t;
    const chars = [...t];
    while (chars.length > 1 && this.measure(chars.join("") + "…", size, opts) > width) chars.pop();
    return chars.join("") + "…";
  }

  ensureSpace(h: number) {
    if (this.y - h < 78) this.newPage();
  }

  hLine(x1: number, x2: number, y?: number, thickness = 0.7, color: RGB = [0.15, 0.15, 0.18]) {
    const yy = y ?? this.y + 4;
    this.page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness, color: rgb(...color) });
  }

  vLine(x: number, y1: number, y2: number, thickness = 0.5, color: RGB = [0.15, 0.15, 0.18]) {
    this.page.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, thickness, color: rgb(...color) });
  }

  line(text: string, opts: TextOpts = {}) {
    const size = opts.size ?? 10;
    if (opts.width && opts.align !== "right" && opts.align !== "center") {
      for (const l of this.wrap(text, opts.width, size, opts)) {
        this.ensureSpace(size + 4);
        this.text(l, { ...opts, width: undefined });
        this.y -= size + 4;
      }
      return;
    }
    this.ensureSpace(size + 4);
    this.text(text, opts);
    this.y -= size + 4;
  }

  paragraph(text: string, width: number, opts: TextOpts = {}) {
    const size = opts.size ?? 10;
    for (const l of this.wrap(text, width, size, opts)) this.line(l, { ...opts, size, width: undefined });
  }

  wrap(text: string, width: number, size: number, opts: { bold?: boolean; face?: FontFace } = {}): string[] {
    const out: string[] = [];
    for (const para of this.clean(text).split("\n")) {
      let cur = "";
      for (const word of para.split(" ")) {
        const test = cur ? `${cur} ${word}` : word;
        if (this.measure(test, size, opts) > width && cur) {
          out.push(cur);
          cur = word;
        } else cur = test;
      }
      out.push(cur);
    }
    return out;
  }

  /** Trennlinie über die volle Breite; y rückt danach um `after` nach unten. */
  hr(after = 12) {
    this.ensureSpace(after + 4);
    this.hLine(MARGIN, A4.w - MARGIN, this.y + 2, 0.5, [0.75, 0.75, 0.78]);
    this.y -= after;
  }

  /** Einfache Tabelle (Berichte) mit Kopfzeile, wiederholt den Kopf nach Seitenumbruch */
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
      const wrapped = r.map((cell, i) => (cols[i].align === "right" ? [cell ?? ""] : this.wrap(cell ?? "", cols[i].width - 6, size)));
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

  /**
   * Rastertabelle wie in der Musterrechnung: schwarzer Kopf, Zellrahmen.
   * Die Zeilenhöhe wird vor dem Zeichnen aus dem umbrochenen Inhalt berechnet,
   * Linien liegen deshalb immer zwischen den Zeilen und nie durch Text.
   * Eine Zelle darf aus mehreren Teilen bestehen (fett + Untertitel).
   */
  gridTable(
    cols: { title: string; width: number; align?: "left" | "right" }[],
    rows: { parts: { text: string; bold?: boolean; color?: RGB }[] }[][],
    opts: { size?: number; x?: number } = {},
  ) {
    const size = opts.size ?? 9;
    const x0 = opts.x ?? MARGIN;
    const lh = size + 3.5;
    const padX = 6;
    const padY = 8;
    const headH = size + 14;
    const totalW = cols.reduce((s, c) => s + c.width, 0);
    const border: RGB = [0.72, 0.72, 0.74];

    const header = () => {
      const top = this.y;
      this.page.drawRectangle({ x: x0, y: top - headH, width: totalW, height: headH, color: rgb(0.05, 0.05, 0.06) });
      let x = x0;
      for (const c of cols) {
        this.drawAt(this.page, c.title, x + padX, top - headH / 2 - size * 0.35, {
          size: size - 0.5, bold: true, color: [1, 1, 1], align: c.align, width: c.width - 2 * padX,
        });
        x += c.width;
      }
      this.y = top - headH;
    };

    if (this.y - headH - 40 < 78) this.newPage();
    header();
    for (const row of rows) {
      const cellLines = row.map((cell, i) =>
        cell.parts.flatMap((p) =>
          (cols[i].align === "right" ? [p.text] : this.wrap(p.text, cols[i].width - 2 * padX, size, { bold: p.bold }))
            .map((t) => ({ t, bold: p.bold, color: p.color })),
        ),
      );
      const n = Math.max(1, ...cellLines.map((l) => l.length));
      const rowH = n * lh + 2 * padY - 3.5;
      if (this.y - rowH < 78) {
        this.newPage();
        header();
      }
      const top = this.y;
      this.page.drawRectangle({
        x: x0, y: top - rowH, width: totalW, height: rowH,
        borderColor: rgb(...border), borderWidth: 0.6,
      });
      let x = x0;
      cols.forEach((c, i) => {
        if (i > 0) this.vLine(x, top, top - rowH, 0.6, border);
        cellLines[i].forEach((l, li) => {
          this.drawAt(this.page, l.t, x + padX, top - padY - size * 0.8 - li * lh, {
            size, bold: l.bold, color: l.color, align: c.align, width: c.width - 2 * padX,
          });
        });
        x += c.width;
      });
      this.y = top - rowH;
    }
  }

  /** Rastertabelle mit einfachen Textzellen. */
  tableOpen(cols: { title: string; width: number; align?: "left" | "right" }[], rows: string[][], size = 9) {
    this.gridTable(cols, rows.map((r) => r.map((t) => ({ parts: [{ text: t ?? "" }] }))), { size });
  }

  footerOnAllPages(text: string, extraLines: string[] = []) {
    const pages = this.doc.getPages();
    pages.forEach((p, i) => {
      const lines = extraLines.length
        ? [...extraLines, `Seite ${i + 1} / ${pages.length}`]
        : [`${text}   ·   Seite ${i + 1} / ${pages.length}`];
      const lineY = 22 + lines.length * 9;
      p.drawLine({ start: { x: MARGIN, y: lineY }, end: { x: A4.w - MARGIN, y: lineY }, thickness: 0.4, color: rgb(0.8, 0.8, 0.82) });
      lines.forEach((line, li) => {
        const maxW = A4.w - 2 * MARGIN;
        const size = 6.5;
        const t = this.fit(line, maxW, size);
        this.drawAt(p, t, MARGIN, 18 + (lines.length - 1 - li) * 9, { size, color: [0.35, 0.35, 0.4] });
      });
    });
  }

  fillRect(x: number, y: number, width: number, height: number, color: RGB) {
    this.page.drawRectangle({ x, y, width, height, color: rgb(...color) });
  }

  strokeRect(x: number, y: number, width: number, height: number, thickness = 0.8, fill?: RGB, stroke: RGB = [0.2, 0.2, 0.22]) {
    this.page.drawRectangle({
      x, y, width, height, borderColor: rgb(...stroke), borderWidth: thickness,
      ...(fill ? { color: rgb(...fill) } : {}),
    });
  }

  async embedImage(dataUrlOrBytes: string | Uint8Array) {
    const bytes = typeof dataUrlOrBytes === "string"
      ? Buffer.from(dataUrlOrBytes.replace(/^data:image\/\w+;base64,/, ""), "base64")
      : dataUrlOrBytes;
    try {
      return await this.doc.embedPng(bytes);
    } catch {
      return this.doc.embedJpg(bytes);
    }
  }

  save() {
    return this.doc.save();
  }
}
