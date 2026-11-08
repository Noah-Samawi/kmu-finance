"use client";

// Texterkennung im Browser: Fotos per Tesseract (Deutsch), PDFs über den Textlayer (Scans: Seite rendern + OCR).
// Es verlässt keine Datei das Gerät – erkannt wird lokal, gebucht wird erst nach Bestätigung.
import { parseReceiptText, type ReceiptSuggestion } from "@/domain/ocr";

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

/** Beleg (Foto oder PDF) lesen → Lieferant, Betrag, Datum, Zahlungsart (Bar/Karte), MwSt, Kategorie */
export async function recognizeReceipt(file: File, onProgress?: (p: number) => void): Promise<ReceiptSuggestion & { text: string }> {
  let text = "";
  if (isPdf(file)) {
    text = (await pdfText(file, 3)).text;
    if (text.replace(/\s/g, "").length < 20) text = await ocrImage(await pdfFirstPageCanvas(file), onProgress);
  } else {
    text = await ocrImage(file, onProgress);
  }
  return { ...parseReceiptText(text), text };
}
