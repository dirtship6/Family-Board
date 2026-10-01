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
  else if (name.endsWith(".html") || name.endsWith(".htm") || name.endsWith(".xhtml")) {
    const r = htmlToText(await file.text());
    text = r.text;
    title = r.title || title;
  } else text = await file.text();
  return { title, text: cleanText(text) };
}

// --- Packages: offline course downloads (.zip) and e-books (.epub) ---

const DOC_EXT = /\.(pdf|docx|html?|xhtml|txt|md)$/i;
/** Skip navigation stubs, cover pages, and other near-empty files in packages. */
const MIN_PACKAGE_CHARS = 400;

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

function resolvePath(base: string, href: string): string {
  const parts = (base ? `${base}/${href}` : href).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p && p !== ".") out.push(p);
  }
  return decodeURIComponent(out.join("/"));
}

async function epubToDocs(files: Record<string, Uint8Array>, bookName: string): Promise<ImportedDoc[]> {
  const container = files["META-INF/container.xml"];
  if (!container) throw new Error("not a valid EPUB (missing container.xml)");
  const parser = new DOMParser();
  const opfPath = parser.parseFromString(decode(container), "application/xml").querySelector("rootfile")?.getAttribute("full-path");
  if (!opfPath || !files[opfPath]) throw new Error("not a valid EPUB (missing package file)");
  const opf = parser.parseFromString(decode(files[opfPath]), "application/xml");
  const base = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/")) : "";
  const manifest = new Map<string, string>();
  opf.querySelectorAll("manifest > item").forEach((it) => {
    const id = it.getAttribute("id");
    const href = it.getAttribute("href");
    if (id && href) manifest.set(id, resolvePath(base, href.split("#")[0]));
  });
  const docs: ImportedDoc[] = [];
  opf.querySelectorAll("spine > itemref").forEach((ref) => {
    const path = manifest.get(ref.getAttribute("idref") ?? "");
    const data = path ? files[path] : undefined;
    if (!data) return;
    const html = decode(data);
    const { title, text } = htmlToText(html);
    const clean = cleanText(text);
    if (clean.length < MIN_PACKAGE_CHARS) return;
    const heading = new DOMParser().parseFromString(html, "text/html").querySelector("h1, h2, h3")?.textContent?.trim();
    docs.push({ title: heading || title || `${bookName} — part ${docs.length + 1}`, text: clean });
  });
  return docs;
}

async function zipToDocs(files: Record<string, Uint8Array>): Promise<ImportedDoc[]> {
  const docs: ImportedDoc[] = [];
  const paths = Object.keys(files)
    .filter((p) => !p.endsWith("/") && !/(^|\/)(__MACOSX|\.)/.test(p))
    .sort(naturalCompare);
  for (const path of paths) {
    const name = path.split("/").pop()!;
    const folder = path.split("/").slice(0, -1).pop();
    try {
      if (/\.(zip|epub)$/i.test(name)) {
        docs.push(...(await importPackage(new File([files[path] as BlobPart], name))));
        continue;
      }
      if (!DOC_EXT.test(name)) continue;
      const doc = await importFile(new File([files[path] as BlobPart], name.replace(/\.xhtml$/i, ".html")));
      // Web pages in course packages are often navigation stubs; real documents are always kept.
      if (/\.(html?|xhtml)$/i.test(name) && doc.text.length < MIN_PACKAGE_CHARS) continue;
      if (!doc.text.trim()) continue;
      // Prefix with the lesson folder so readings from different lessons stay distinguishable.
      if (folder && !doc.title.toLowerCase().includes(folder.toLowerCase())) doc.title = `${folder.replace(/[_-]+/g, " ")} — ${doc.title}`;
      docs.push(doc);
    } catch {
      // One unreadable file shouldn't sink the whole package.
    }
  }
  return docs;
}

/** Unpacks a .zip (e.g. an offline course download) or .epub into separate readings, in order. */
export async function importPackage(file: File): Promise<ImportedDoc[]> {
  const { unzipSync } = await import("fflate");
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  if (file.name.toLowerCase().endsWith(".epub") || files["META-INF/container.xml"]) {
    return epubToDocs(files, baseName(file.name));
  }
  return zipToDocs(files);
}

/** Any supported file → one or more readings. */
export async function importAny(file: File): Promise<ImportedDoc[]> {
  if (/\.(zip|epub)$/i.test(file.name)) return importPackage(file);
  return [await importFile(file)];
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

export const ACCEPTED_FILES = ".pdf,.docx,.txt,.md,.html,.htm,.xhtml,.zip,.epub";
