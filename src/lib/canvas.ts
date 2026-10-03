// Canvas offline course exports ("Download course content"): a zip with
// index.html, viewer/course-data.js (the whole course as JSON) and viewer/files/.
// Module order drives import order: each lesson page, then the files it links to.

export interface CanvasItem {
  title: string;
  type: string; // WikiPage, Assignment, Quizzes::Quiz, ExternalUrl, ...
  content?: string;
  pointsPossible?: number | null;
  dueAt?: string | null;
}

export interface CanvasCourse {
  title: string;
  modules: { name: string; items: CanvasItem[] }[];
}

export const COURSE_DATA_PATH = /(^|\/)viewer\/course-data\.js$/;

/** Parses `window.COURSE_DATA = {...};` without evaluating any script. */
export function parseCourseData(js: string): CanvasCourse {
  const start = js.indexOf("{");
  const end = js.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("course-data.js has no course object");
  const data = JSON.parse(js.slice(start, end + 1)) as CanvasCourse;
  if (!Array.isArray(data.modules)) throw new Error("course-data.js has no modules");
  return data;
}

export interface LinkedRef {
  /** Path inside the export, relative to the folder holding index.html. */
  path?: string;
  url?: string;
  label: string;
  kind: "file" | "video" | "link";
}

const SKIP_URL = /community\.canvaslms\.com|\/profile\/|^mailto:|^#|^announcements$/i;

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"));
  return m ? m[1].replace(/&amp;/g, "&") : undefined;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

/** Alt text of an icon inside a link, minus file extensions and "icon_" prefixes. */
function imgAlt(tag: string): string {
  const alt = tag.match(/<img\b[^>]*\balt\s*=\s*"([^"]*)"/i)?.[1] ?? "";
  return alt.replace(/\.(png|jpe?g|gif|svg)$/i, "").replace(/^icon[_ ]/i, "").replace(/[_]+/g, " ").trim();
}

function videoLabel(url: string, n: number): string {
  if (/youtube\.com|youtu\.be/.test(url)) return `Video ${n} (YouTube)`;
  const ted = url.match(/ted\.com\/talks\/([^/?]+)/);
  if (ted) return `TED: ${ted[1].replace(/_/g, " ")}`;
  if (/h5p/.test(url)) return `Interactive ${n}`;
  return `Video ${n}`;
}

/** Files, outside links, and embedded videos referenced by a page, in page order. */
export function extractRefs(html: string): LinkedRef[] {
  const refs: LinkedRef[] = [];
  const seen = new Set<string>();
  let videos = 0;
  for (const m of html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>|<iframe\b[^>]*>/gi)) {
    const tag = m[0];
    const isFrame = /^<iframe/i.test(tag);
    const raw = attr(tag, isFrame ? "src" : "href");
    if (!raw || SKIP_URL.test(raw)) continue;
    const local = raw.match(/^(?:\.\/)?(viewer\/files\/[^?#]+)/);
    if (local) {
      let path: string;
      try {
        path = decodeURIComponent(local[1]);
      } catch {
        path = local[1];
      }
      if (seen.has(path)) continue;
      seen.add(path);
      refs.push({ path, label: stripTags(tag) || imgAlt(tag) || path.split("/").pop()!, kind: "file" });
      continue;
    }
    if (!/^https?:/i.test(raw)) continue;
    const key = raw.split("?")[0];
    if (seen.has(key)) continue;
    seen.add(key);
    if (isFrame) {
      const url = raw.replace(/youtube\.com\/embed\/([\w-]+).*/, "youtube.com/watch?v=$1");
      refs.push({ url, label: videoLabel(raw, ++videos), kind: "video" });
    } else {
      const label = stripTags(tag) || imgAlt(tag) || decodeURIComponent(raw.split(/[?#]/)[0].split("/").filter(Boolean).pop() ?? "");
      refs.push({ url: raw, label: label || new URL(raw).hostname, kind: "link" });
    }
  }
  return refs;
}

/**
 * "pdf_Coleman, Military Ethics_An Introduction with Case Studies (2013) p1-7.pdf"
 *   → { title: "Military Ethics: An Introduction with Case Studies", author: "Coleman", year: "2013" }
 */
export function describeFile(fileName: string): { title: string; author?: string; year?: string } {
  const base = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/^(pdf|doc|docx|file)[_ ]/i, "")
    .replace(/[_ ]\d{1,2}[A-Z][a-z]{2}\d{2,4}$/, "") // version stamps like _10Apr26
    .replace(/_/g, ": ")
    .replace(/\s+/g, " ")
    .trim();
  // "Author, Title (Year) p12-19" — year and page range are optional.
  const m = base.match(/^([^,:]{2,40}),\s*(.+?)\s*(?:\((\d{4}|n\.?d\.?)\))?(?:\s+p{1,2}\.?\s*[\d,\s-]+)?$/i);
  if (!m) return { title: base };
  const year = m[3] && /^\d{4}$/.test(m[3]) ? m[3] : undefined;
  return { title: m[2].replace(/[.:]\s*$/, "").trim(), author: m[1].trim(), year };
}

/** Lesson modules whose pages all came down empty (usually locked when the export was made). */
export function emptyModules(course: CanvasCourse): string[] {
  return course.modules
    .filter((m) => {
      const pages = m.items.filter((i) => i.type === "WikiPage");
      return pages.length > 0 && pages.every((i) => !i.content?.trim());
    })
    .map((m) => m.name);
}

/** Page boilerplate that shouldn't be narrated. */
export function stripBoilerplate(text: string): string {
  return text
    .split("\n")
    .filter((l) => !/^\s*(be sure to click\s+)?"?mark as done"?|click "mark as done"/i.test(l.trim()))
    .join("\n");
}

const STOP = new Set(["the", "and", "for", "with", "from", "into", "its", "our", "are", "read", "pages", "page"]);
const titleWords = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  );

/**
 * Finds the lesson's reading instruction for each linked document, e.g. the line
 * "Communication in Organizations (2008) Read pages 334-335 and 364-365" for the Greenberg PDF.
 * Returns the instruction part ("Read pages 334-335 and 364-365") per title, or undefined.
 */
export function matchAssignments(pageText: string, docTitles: string[]): (string | undefined)[] {
  const lines = pageText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /\b(read|pages?)\b[^.]*\d/i.test(l));
  return docTitles.map((title) => {
    const want = titleWords(title);
    if (!want.size) return undefined;
    let best: { score: number; instruction: string } | undefined;
    for (const line of lines) {
      const at = line.search(/\b(read|pages?)\b/i);
      const head = line.slice(0, at).replace(/\((?:\d{4}|n\.?d\.?)\)\s*$/i, "");
      const have = titleWords(head);
      if (!have.size) continue;
      const shared = [...want].filter((w) => have.has(w)).length;
      const score = shared / Math.min(want.size, have.size);
      if (score >= 0.8 && (!best || score > best.score)) best = { score, instruction: line.slice(at).trim() };
    }
    return best?.instruction;
  });
}
