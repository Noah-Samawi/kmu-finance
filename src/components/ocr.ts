"use client";

// Belegerkennung: zuerst KI (Google Gemini über /api/scan-receipt, liest Foto und PDF direkt).
// Ist die KI nicht erreichbar/nicht eingerichtet, Rückfall auf lokale Texterkennung im Browser:
// Fotos per Tesseract (Deutsch), PDFs über den Textlayer (Scans: Seite rendern + OCR).
// Gebucht wird in jedem Fall erst nach Bestätigung durch den Nutzer.
import { parseReceiptText, SCAN_MAX_BYTES, SCAN_MIME_TYPES, type ScanResult } from "@/domain/ocr";
import { shrinkImage } from "@/components/shrink-image";

type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import("pdfjs-dist").then((m) => {
    m.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${m.version}/build/pdf.worker.min.mjs`;
    return m;
  });
  return pdfjsPromise;
}

async function ocrImage(image: File | Blob | HTMLCanvasElement, onProgress?: (p: number) => void): Promise<string> {
  const { recognize } = await import("tesseract.js");
  const { data } = await recognize(image, "deu", {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text") onProgress?.(m.progress);
    },
  });
  return data.text;
}

const isPdf = (f: File) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");

/** Text eines PDFs zeilenweise (Textelemente mit gleicher y-Position = eine Zeile) */
export async function pdfText(file: File, maxPages = 30): Promise<{ text: string; pages: number }> {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out: string[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const lines = new Map<number, { x: number; s: string }[]>();
    for (const it of content.items) {
      if (!("str" in it) || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]);
      const key = [...lines.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
      lines.set(key, [...(lines.get(key) ?? []), { x: it.transform[4], s: it.str }]);
    }
    [...lines.entries()].sort((a, b) => b[0] - a[0])
      .forEach(([, parts]) => out.push(parts.sort((a, b) => a.x - b.x).map((x) => x.s).join(" ").replace(/\s+/g, " ").trim()));
  }
  return { text: out.join("\n"), pages: doc.numPages };
}

async function pdfFirstPageCanvas(file: File): Promise<HTMLCanvasElement> {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
  return canvas;
}

export type RecognizedReceipt = ScanResult & { text: string };

/** KI-Scan über den Server; null = nicht verfügbar (dann lokal weiter) */
async function scanWithAi(file: File): Promise<ScanResult | null> {
  try {
    const f = await shrinkImage(file);
    if (f.size > SCAN_MAX_BYTES || !(SCAN_MIME_TYPES as readonly string[]).includes(f.type)) return null;
    const fd = new FormData();
    fd.set("file", f);
    const res = await fetch("/api/scan-receipt", { method: "POST", body: fd });
    if (!res.ok) return null;
    const data = (await res.json()) as { scan?: ScanResult };
    return data.scan ?? null;
  } catch {
    return null;
  }
}

/** Beleg (Foto oder PDF) lesen → Händler, Betrag, Datum, MwSt, Kategorie, Zahlungsart (Hinweis) */
export async function recognizeReceipt(file: File, onProgress?: (p: number) => void): Promise<RecognizedReceipt> {
  const ai = await scanWithAi(file);
  if (ai && (ai.amountCents || ai.merchant)) return { ...ai, text: "" };

  let text = "";
  if (isPdf(file)) {
    text = (await pdfText(file, 3)).text;
    if (text.replace(/\s/g, "").length < 20) text = await ocrImage(await pdfFirstPageCanvas(file), onProgress);
  } else {
    text = await ocrImage(file, onProgress);
  }
  return { ...parseReceiptText(text), description: null, vatAmountCents: null, customCategory: null, source: "local", text };
}
