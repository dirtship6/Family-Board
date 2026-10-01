// Extracts plain text from the file types ACSC readings usually come in.
import { cleanText } from "./text";

export interface ImportedDoc {
  title: string;
  text: string;
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
}

async function pdfToText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let line = "";
    const lines: string[] = [];
    let lastY: number | null = null;
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const y = item.transform[5];
      // A big vertical jump between lines usually marks a new paragraph.
      if (lastY !== null && Math.abs(lastY - y) > (item.height || 10) * 1.8 && line) {
        lines.push(line, "");
        line = "";
      }
      line += item.str;
      if (item.hasEOL) {
        lines.push(line);
        line = "";
      }
      lastY = y;
    }
    if (line) lines.push(line);
    pages.push(lines.join("\n"));
  }
  return pages.join("\n\n");
}

async function docxToText(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return value;
}

export function htmlToText(html: string): { title: string; text: string } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,nav,header,footer,aside,noscript,svg").forEach((n) => n.remove());
  const root = doc.querySelector("article, main") ?? doc.body;
  const blocks = Array.from(root.querySelectorAll("h1,h2,h3,h4,p,li,blockquote"))
    .map((n) => n.textContent?.trim() ?? "")
    .filter(Boolean);
  const text = blocks.length ? blocks.join("\n\n") : root.textContent ?? "";
  return { title: doc.title, text };
}

export async function importFile(file: File): Promise<ImportedDoc> {
  const name = file.name.toLowerCase();
  let text: string;
  let title = baseName(file.name);
  if (name.endsWith(".pdf")) text = await pdfToText(file);
  else if (name.endsWith(".docx")) text = await docxToText(file);
  else if (name.endsWith(".html") || name.endsWith(".htm")) {
    const r = htmlToText(await file.text());
    text = r.text;
    title = r.title || title;
  } else text = await file.text();
  return { title, text: cleanText(text) };
}

export async function importUrl(url: string): Promise<ImportedDoc> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("pdf")) {
    const blob = await res.blob();
    return importFile(new File([blob], url.split("/").pop() || "reading.pdf"));
  }
  const body = await res.text();
  if (type.includes("html")) {
    const r = htmlToText(body);
    return { title: r.title || url, text: cleanText(r.text) };
  }
  return { title: url, text: cleanText(body) };
}

export const ACCEPTED_FILES = ".pdf,.docx,.txt,.md,.html,.htm";
