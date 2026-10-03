// "Listening cleanup": decides what narration skips and how each sentence is spoken.
// The stored text never changes here, so everything stays visible and searchable;
// only what is read aloud is streamlined.
import { assignmentStatus } from "./pages";
import { cleanText, toSentences, type Sentence } from "./text";
import type { Reading } from "./types";

export type SkipKind = "references" | "table" | "unassigned";

export interface SpokenSentence extends Sentence {
  /** Text sent to the voice; differs from `text` when citations etc. were removed. */
  speak: string;
  /** Set when narration should pass over this sentence. */
  skip?: SkipKind;
}

// --- Inline clutter -------------------------------------------------------------

const YEAR = String.raw`(?:1[6-9]\d\d|20\d\d)[a-z]?|n\.\s?d\.`;
// (Barley, Meyer, and Gash, 1988; Martin, 1991) · (see Smith et al., 2004, p. 12) · (Northouse 2013)
const AUTHOR_YEAR_CITE = new RegExp(
  String.raw`\s?\((?:(?:see|e\.g\.,?|cf\.|for example,?)\s+)?[A-Z][^()]{0,160}?\b(?:${YEAR})(?:,?\s*(?:pp?\.\s*)?[\d\-–, ]+)?(?:;\s*[^()]{0,160}?\b(?:${YEAR})(?:,?\s*(?:pp?\.\s*)?[\d\-–, ]+)?)*\)`,
  "g",
);
const NUMERIC_CITE = /\s?\[(?:\d{1,3}(?:\s*[-–,]\s*\d{1,3})*)\]/g; // [12], [3-5, 9]
const PAGE_REF = /\s?\((?:pp?\.|page|pages)\s*[\d\-–, ]+\)/gi; // (p. 12)
const URL = /\s?(?:https?:\/\/|www\.)\S+|\s?\bdoi:\s?\S+/gi;
// Footnote numbers glued to the end of a word or after punctuation: "leadership.12 " / "culture12," / "end.”3"
const FOOTNOTE_NUM = /(?<=[a-z\)\]][.,;:!?]?["”’]?)\d{1,3}(?=\s|$|[,.;:])/g;

/** The sentence as it should be spoken: citations, footnote numbers, and URLs removed. */
export function speakable(text: string): string {
  const out = text
    .replace(URL, "")
    .replace(AUTHOR_YEAR_CITE, "")
    .replace(NUMERIC_CITE, "")
    .replace(PAGE_REF, "")
    .replace(FOOTNOTE_NUM, "")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  // Never reduce a sentence to nothing because of a false positive.
  return /[A-Za-z]{2}/.test(out) ? out : text;
}

// --- Whole sections: reference lists, endnotes, tables ---------------------------

const REF_HEADING = /^(?:\d+\.?\s*)?(references?|reference list|notes|endnotes|end notes|bibliography|works cited|sources|literature cited|selected bibliography|suggested readings?)\s*:?$/i;

/** Looks like one entry of a bibliography or endnote list. */
export function isCitationEntry(para: string): boolean {
  const p = para.replace(/\s+/g, " ").trim();
  if (/^\d{1,3}\.\s+Ibid\b/i.test(p)) return true;
  if (p.length < 15 || p.length > 900) return false;
  const hasYear = new RegExp(String.raw`\b(?:${YEAR})\b`).test(p);
  const numbered = /^\[?\d{1,3}[.)\]]\s+\S/.test(p);
  const apa = /^[A-Z][A-Za-z'’\-]+,\s(?:[A-Z]\.\s?){1,3}/.test(p); // Hinck, A. M.
  const chicagoBib = /^[A-Z][A-Za-z'’\-]+,\s[A-Z][a-z]+/.test(p) && /\.\s/.test(p); // Schein, Edgar. Title.
  const pubMarks = /\b(Press|Publish|Journal|Review|University|Vol\.|vol\.|no\.|pp\.|Retrieved|doi|https?:|ed\.|eds\.|Ibid|Ibid\.|op\. cit)\b/.test(p);
  return (numbered || apa || chicagoBib) && (hasYear || pubMarks);
}

/** Paragraph with its original line breaks; same indexing as Sentence.p. */
function rawParagraphs(text: string): string[] {
  return cleanText(text)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** A paragraph that is really a table or figure flattened into short fragments. */
export function isTableFragment(para: string, medianLine: number): boolean {
  const lines = para.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 5) return false;
  const avg = lines.reduce((n, l) => n + l.length, 0) / lines.length;
  const sentenceEnds = lines.filter((l) => /[.!?:]["”’)]?$/.test(l)).length / lines.length;
  const words = para.split(/\s+/).length;
  // Count sentence endings, including ones after a closing bracket or quote ("…(the receiver).").
  const sentences = (para.match(/[a-z0-9)\]"”’][.!?]["”’)]?(\s|$)/g) ?? []).length;
  // Short choppy lines that rarely end sentences, and few complete sentences overall.
  return avg < medianLine * 0.5 && sentenceEnds < 0.25 && sentences / Math.max(words / 18, 1) < 0.35;
}

/** Short fragments that are mostly symbols: logos and artwork the PDF turned into characters ("~~c;,f/ ZurichuzH"). */
export function isSymbolNoise(para: string): boolean {
  const t = para.replace(/\s+/g, "");
  if (!t || t.length > 60) return false;
  const alnum = (t.match(/[A-Za-z0-9]/g) ?? []).length;
  const odd = (t.match(/[~^|\\{}<>_=;]/g) ?? []).length;
  return alnum / t.length < 0.5 || odd >= 3;
}

export function classifyParagraphs(text: string): (SkipKind | null)[] {
  const paras = rawParagraphs(text);
  const out: (SkipKind | null)[] = paras.map(() => null);
  if (!paras.length) return out;

  const lines = paras.flatMap((p) => p.split("\n")).map((l) => l.trim().length).filter((n) => n > 0).sort((a, b) => a - b);
  const medianLine = lines[Math.floor(lines.length / 2)] ?? 80;
  paras.forEach((p, i) => {
    if (isTableFragment(p, medianLine) || isSymbolNoise(p)) out[i] = "table";
  });

  const flat = paras.map((p) => p.replace(/\s+/g, " ").trim());
  const total = flat.length;
  const yearRe = new RegExp(String.raw`\b(?:${YEAR})\b`);
  const pubRe = /\b(?:Press|Publish\w*|Journal|Quarterly|Review|University|Vol\.|vol\.|no\.|pp\.|Retrieved|doi|Ibid|op\. cit|Eds?\.)/;
  // Reference entries carry years, page ranges, or publisher markers; a long paragraph with none is prose.
  const citeish = (p: string) => yearRe.test(p) || pubRe.test(p) || /https?:|www\./.test(p);
  const isProse = (p: string) => p.length >= 200 && !citeish(p);
  const offsets: number[] = [];
  flat.reduce((pos, p, i) => ((offsets[i] = pos), pos + p.length), 0);
  const totalChars = flat.reduce((n, p) => n + p.length, 0) || 1;

  // 1) A references/notes heading (its own line, at the start of a paragraph) past the first ~30%:
  //    skip it and everything after it until normal prose clearly resumes.
  for (let i = 0; i < total; i++) {
    if (offsets[i] / totalChars < 0.3) continue;
    const lines = paras[i].split("\n").map((l) => l.trim());
    const h = lines.findIndex((l) => REF_HEADING.test(l));
    if (h < 0 || h > 1) continue;
    if (i >= total - 1) {
      out[i] = "references"; // heading printed after its endnotes, at the very end
      continue;
    }
    let last = i;
    let proseRun = 0;
    for (let j = i + 1; j < total && proseRun < 2; j++) {
      if (isProse(flat[j])) proseRun++;
      else {
        proseRun = 0;
        last = j;
      }
    }
    const entries = flat.slice(i, last + 1).filter(citeish).length;
    if (entries >= 2) for (let k = i; k <= last; k++) out[k] = "references";
  }

  // 2) Endnotes or a bibliography at the end with no heading before them (e.g. "NOTES" printed last).
  let start = total;
  for (let i = total - 1; i >= 0; i--) {
    if (isProse(flat[i])) break;
    if (citeish(flat[i]) || flat[i].length < 60) start = i;
    else break;
  }
  const tail = flat.slice(start);
  const numbered = tail.join("\n").match(/(?:^|\s)\d{1,3}\.\s+[A-Z“"]/g)?.length ?? 0;
  const entries = tail.filter(isCitationEntry).length;
  if (tail.length && (numbered >= 3 || entries >= 3) && tail.filter(citeish).length >= Math.ceil(tail.length * 0.6)) {
    for (let k = start; k < total; k++) out[k] ??= "references";
  }

  return out;
}

export interface NarrationOptions {
  cleanup: boolean;
  /** Paragraphs on pages the lesson doesn't assign. */
  unassigned?: Set<number>;
}

/** Sentences ready for narration: what to say, and what to pass over. */
export function toSpokenSentences(text: string, opts: NarrationOptions): SpokenSentence[] {
  const sentences = toSentences(text);
  const kinds = opts.cleanup ? classifyParagraphs(text) : [];
  return sentences.map((s) => {
    const skip: SkipKind | undefined = opts.unassigned?.has(s.p) ? "unassigned" : kinds[s.p] ?? undefined;
    return { ...s, speak: skip || !opts.cleanup ? s.text : speakable(s.text), skip };
  });
}

/** Narration plan for a reading under the current settings. */
export function narrationFor(
  r: Pick<Reading, "text" | "assignment" | "pageStarts" | "pageNumbers" | "readAll">,
  settings: { listeningCleanup: boolean; assignedOnly: boolean },
): SpokenSentence[] {
  const status = settings.assignedOnly && !r.readAll ? assignmentStatus(r) : null;
  return toSpokenSentences(r.text, {
    cleanup: settings.listeningCleanup,
    unassigned: status?.kind === "partial" ? status.skipParas : undefined,
  });
}

/** Words narration will actually speak, for time estimates. */
export function listenWordCount(
  r: Pick<Reading, "text" | "assignment" | "pageStarts" | "pageNumbers" | "readAll">,
  settings: { listeningCleanup: boolean; assignedOnly: boolean } = { listeningCleanup: true, assignedOnly: true },
): number {
  return narrationFor(r, settings).reduce((n, s) => n + (s.skip ? 0 : s.speak.split(/\s+/).filter(Boolean).length), 0);
}

// --- Repairing ligatures that some PDFs drop ("Te" → "The", "difcult" → "difficult") ---

/** Characters a broken ligature loses after the letter that survives. */
const LIGATURE_TAILS: Record<string, string[]> = { f: ["i", "l", "f", "t", "fi", "fl"], F: ["i", "l"], T: ["h"], t: ["h"] };

function wordCounts(texts: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of texts) for (const w of t.match(/[A-Za-z]+/g) ?? []) {
    const k = w.toLowerCase();
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function candidatesFor(word: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < word.length; i++) {
    for (const tail of LIGATURE_TAILS[word[i]] ?? []) out.push(word.slice(0, i + 1) + tail + word.slice(i + 1));
  }
  return out;
}

/**
 * Fixes words damaged by dropped ligatures, using the rest of the library as a dictionary.
 * Only acts on a document that clearly shows the damage pattern, so normal text is never touched.
 */
export function repairLigatures(text: string, otherTexts: string[]): { text: string; fixes: number } {
  const library = wordCounts(otherTexts);
  const own = wordCounts([text]);
  const fixFor = new Map<string, string>();
  const decide = (lower: string): string | undefined => {
    const seen = library.get(lower) ?? 0;
    let best: string | undefined;
    let bestCount = 0;
    for (const c of candidatesFor(lower)) {
      const n = library.get(c) ?? 0;
      if (n > bestCount) [best, bestCount] = [c, n];
    }
    if (!best) return undefined;
    return seen === 0 && bestCount >= 3 ? best : undefined;
  };
  // Pass 1: words the library never uses but a repaired form it uses often ("difculty").
  for (const w of own.keys()) {
    const fix = decide(w);
    if (fix) fixFor.set(w, fix);
  }
  const damaged = [...fixFor.keys()].reduce((n, w) => n + (own.get(w) ?? 0), 0);
  if (fixFor.size < 4 || damaged < 10) return { text, fixes: 0 };
  // Pass 2, only in a damaged document: real-but-rare words that are almost surely damaged ("Te", "Ten" for
  // "Then"), judged case-sensitively against how often the repaired form appears in this document.
  const ownExact = new Map<string, number>();
  for (const w of text.match(/[A-Za-z]+/g) ?? []) ownExact.set(w, (ownExact.get(w) ?? 0) + 1);
  const exactFix = new Map<string, string>();
  for (const w of ownExact.keys()) {
    const lower = w.toLowerCase();
    if (fixFor.has(lower)) continue;
    const seen = library.get(lower) ?? 0;
    let best: string | undefined;
    let bestCount = 0;
    for (const c of candidatesFor(w)) {
      const n = library.get(c.toLowerCase()) ?? 0;
      if (n > bestCount) [best, bestCount] = [c, n];
    }
    // The correct form may survive in a few places set in another font (titles, headings); the damaged one dominates.
    const intact = ownExact.get(best ?? "") ?? 0;
    if (best && bestCount >= 3 && bestCount >= Math.max(seen, 1) * 20 && intact * 5 < (ownExact.get(w) ?? 0)) exactFix.set(w, best);
  }
  let fixes = 0;
  const out = text.replace(/[A-Za-z]+/g, (w) => {
    const exact = exactFix.get(w);
    if (exact) {
      fixes++;
      return exact;
    }
    const fix = fixFor.get(w.toLowerCase());
    if (!fix) return w;
    fixes++;
    if (w === w.toUpperCase() && w.length > 1) return fix.toUpperCase();
    if (w[0] === w[0].toUpperCase()) return fix[0].toUpperCase() + fix.slice(1);
    return fix;
  });
  return { text: out, fixes };
}
