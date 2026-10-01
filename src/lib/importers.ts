// Extracts plain text from the file types ACSC readings usually come in.
import { COURSE_DATA_PATH, describeFile, emptyModules, extractRefs, parseCourseData, stripBoilerplate } from "./canvas";
import { cleanText, stripRunningLines } from "./text";
import type { ReadingLink, TaskKind } from "./types";

export interface ImportedDoc {
  title: string;
  text: string;
  author?: string;
  year?: string;
  /** Videos and outside articles referenced by this page that couldn't be imported. */
  links?: ReadingLink[];
  /** "page" for an LMS lesson page; otherwise a document. */
  kind?: "page";
}

/** Everything one dropped file produced. Course packages can also yield tasks and paper prompts. */
export interface ImportResult {
  docs: ImportedDoc[];
  /** Course name from the package itself (e.g. a Canvas export's title). */
  course?: string;
  tasks?: { title: string; kind: TaskKind }[];
  papers?: { title: string; prompt: string; wordTarget?: number }[];
  notices?: string[];
}

export type Progress = (message: string) => void;

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
}

async function pdfToText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[][] = [];
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
    // JSTOR prepends a terms-of-use cover sheet; it isn't part of the reading.
    if (i === 1 && lines.some((l) => /JSTOR is a not-for-profit service/i.test(l))) continue;
    pages.push(lines);
  }
  return stripRunningLines(pages).map((p) => p.join("\n")).join("\n\n");
}

async function docxToText(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return value;
}

const BLOCK_TAGS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "BR", "DD", "DIV", "DL", "DT", "FIGCAPTION", "FIGURE", "FOOTER",
  "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "OL", "P", "PRE", "SECTION", "TABLE",
  "TBODY", "TD", "TH", "THEAD", "TR", "UL",
]);

/**
 * Visible text of an HTML page, one block per paragraph. Walks the whole tree so text that sits
 * loose inside table cells or divs (common in LMS pages) is kept, and nothing is read twice.
 */
export function htmlToText(html: string): { title: string; text: string } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,nav,header,footer,aside,noscript,svg,iframe,button,select,template").forEach((n) => n.remove());
  const root = doc.querySelector("article, main") ?? doc.body;
  const blocks: string[] = [];
  let buf = "";
  const flush = () => {
    const t = buf.replace(/\s+/g, " ").trim();
    if (t) blocks.push(t);
    buf = "";
  };
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) buf += child.textContent ?? "";
      else if (child.nodeType === Node.ELEMENT_NODE) {
        const block = BLOCK_TAGS.has((child as Element).tagName);
        if (block) flush();
        walk(child);
        if (block) flush();
        else if ((child as Element).tagName === "IMG") buf += " ";
      }
    }
  };
  if (root) walk(root);
  flush();
  return { title: doc.title, text: blocks.join("\n\n") };
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

function wordTargetFrom(prompt: string): number | undefined {
  const m = prompt.match(/(\d[\d,]{2,5})\s*(?:[-–to]+\s*(\d[\d,]{2,5}))?\s*words?/i);
  if (!m) return undefined;
  return Number((m[2] ?? m[1]).replace(/,/g, ""));
}

/** A Canvas "Download course content" export, imported in module order. */
async function canvasToResult(files: Record<string, Uint8Array>, dataPath: string, onProgress?: Progress): Promise<ImportResult> {
  const course = parseCourseData(decode(files[dataPath]));
  const root = dataPath.replace(/viewer\/course-data\.js$/, "");
  const used = new Set<string>();
  const docs: ImportedDoc[] = [];
  const tasks: NonNullable<ImportResult["tasks"]> = [];
  const papers: NonNullable<ImportResult["papers"]> = [];
  const seenTitles = new Set<string>();

  const importLinkedFile = async (rel: string) => {
    const full = root + rel;
    const name = rel.split("/").pop()!;
    if (used.has(full) || !files[full] || !/\.(pdf|docx|txt|md)$/i.test(name)) return;
    used.add(full);
    onProgress?.(`Importing ${name}`);
    try {
      const doc = await importFile(new File([files[full] as BlobPart], name));
      if (!doc.text.trim()) return;
      docs.push({ ...doc, ...describeFile(name) });
    } catch {
      // Skip unreadable files; the rest of the course still imports.
    }
  };

  for (const mod of course.modules) {
    for (const item of mod.items) {
      const html = item.content ?? "";
      const refs = html ? extractRefs(html) : [];
      const text = html ? cleanText(stripBoilerplate(htmlToText(html).text)) : "";
      const key = item.title.trim().toLowerCase();
      // Pages under ~100 words are admin notes (notification settings, "click next"), not lesson content.
      if (item.type === "WikiPage" && text.split(/\s+/).length >= 100) {
        const links = refs.filter((r) => r.url).map((r) => ({ label: r.label, url: r.url!, kind: r.kind as ReadingLink["kind"] }));
        docs.push({ title: item.title.trim(), text, kind: "page", links: links.length ? links : undefined });
      } else if (item.type === "Assignment" && !seenTitles.has(key)) {
        seenTitles.add(key);
        tasks.push({ title: item.title.trim(), kind: "paper" });
        if (text) papers.push({ title: item.title.trim(), prompt: text, wordTarget: wordTargetFrom(text) });
      } else if (item.type.includes("Quiz") && !seenTitles.has(key)) {
        seenTitles.add(key);
        tasks.push({ title: item.title.trim(), kind: "quiz" });
      }
      for (const r of refs) if (r.path) await importLinkedFile(r.path);
    }
  }

  // Course files no page links to (e.g. extra references) go at the end.
  for (const path of Object.keys(files).sort(naturalCompare)) {
    if (path.startsWith(root + "viewer/files/") && !/(^|\/)(__MACOSX|\.)/.test(path)) await importLinkedFile(path.slice(root.length));
  }

  const notices: string[] = [];
  const empty = emptyModules(course);
  if (empty.length) {
    notices.push(
      `${empty.join(", ")} came down without content, usually because ${empty.length === 1 ? "it was" : "they were"} still locked when the course was downloaded. Download again once ${empty.length === 1 ? "it unlocks" : "they unlock"} and import the new zip; anything already in your library is skipped.`,
    );
  }
  return { docs, course: course.title?.trim(), tasks, papers, notices };
}

async function zipToDocs(files: Record<string, Uint8Array>, onProgress?: Progress): Promise<ImportResult> {
  const dataPath = Object.keys(files).find((p) => COURSE_DATA_PATH.test(p) && !p.includes("__MACOSX"));
  if (dataPath) return canvasToResult(files, dataPath, onProgress);
  const docs: ImportedDoc[] = [];
  const paths = Object.keys(files)
    .filter((p) => !p.endsWith("/") && !/(^|\/)(__MACOSX|\.)/.test(p))
    .sort(naturalCompare);
  for (const path of paths) {
    const name = path.split("/").pop()!;
    const folder = path.split("/").slice(0, -1).pop();
    try {
      if (/\.(zip|epub)$/i.test(name)) {
        docs.push(...(await importPackage(new File([files[path] as BlobPart], name), onProgress)).docs);
        continue;
      }
      if (!DOC_EXT.test(name)) continue;
      onProgress?.(`Importing ${name}`);
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
  return { docs };
}

/** Unpacks a .zip (e.g. an offline course download) or .epub into separate readings, in order. */
export async function importPackage(file: File, onProgress?: Progress): Promise<ImportResult> {
  const { unzipSync } = await import("fflate");
  onProgress?.(`Unpacking ${file.name}`);
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  if (file.name.toLowerCase().endsWith(".epub") || files["META-INF/container.xml"]) {
    return { docs: await epubToDocs(files, baseName(file.name)) };
  }
  return zipToDocs(files, onProgress);
}

/** Any supported file → one or more readings. */
export async function importAny(file: File, onProgress?: Progress): Promise<ImportResult> {
  if (/\.(zip|epub)$/i.test(file.name)) return importPackage(file, onProgress);
  return { docs: [await importFile(file)] };
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
