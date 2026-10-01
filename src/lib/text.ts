// Turns raw reading text into paragraphs of speakable sentences.

export interface Sentence {
  /** Index of the paragraph this sentence belongs to. */
  p: number;
  text: string;
}

// Long run-on "sentences" (common in PDF extractions and footnote blocks)
// are split so speech engines don't stall and highlighting stays useful.
const MAX_SENTENCE_CHARS = 320;

export function cleanText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/­/g, "") // soft hyphens
    .replace(/(\w)-\n(\w)/g, "$1$2") // words hyphenated across line breaks
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function splitParagraphs(text: string): string[] {
  return cleanText(text)
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\n/g, " ").trim())
    .filter(Boolean);
}

function splitLong(sentence: string): string[] {
  if (sentence.length <= MAX_SENTENCE_CHARS) return [sentence];
  const out: string[] = [];
  let rest = sentence;
  while (rest.length > MAX_SENTENCE_CHARS) {
    const window = rest.slice(0, MAX_SENTENCE_CHARS);
    let cut = Math.max(window.lastIndexOf("; "), window.lastIndexOf(", "), window.lastIndexOf(": "));
    if (cut < MAX_SENTENCE_CHARS / 3) cut = window.lastIndexOf(" ");
    if (cut <= 0) cut = MAX_SENTENCE_CHARS - 1;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

const ABBREVIATIONS = /\b(?:Mr|Mrs|Ms|Dr|Gen|Lt|Col|Maj|Capt|Sgt|Adm|Cmdr|Brig|Sen|Rep|Gov|St|Jr|Sr|vs|etc|e\.g|i\.e|cf|al|Fig|No|Vol|pp?|U\.S|U\.K|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.$/i;

function regexSentences(paragraph: string): string[] {
  const parts = paragraph.match(/[^.!?]+(?:[.!?]+["'”’)\]]*|$)\s*/g) ?? [paragraph];
  const merged: string[] = [];
  for (const part of parts) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && (ABBREVIATIONS.test(prev.trim()) || /\b[A-Z]\.$/.test(prev.trim()))) {
      merged[merged.length - 1] = prev + part;
    } else {
      merged.push(part);
    }
  }
  return merged.map((s) => s.trim()).filter(Boolean);
}

function segmentSentences(paragraph: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (!Seg) return regexSentences(paragraph);
  const seg = new Seg("en", { granularity: "sentence" });
  const raw = Array.from(seg.segment(paragraph), (s) => s.segment);
  // Intl.Segmenter still breaks after military ranks and abbreviations; re-join those.
  const merged: string[] = [];
  for (const s of raw) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && ABBREVIATIONS.test(prev.trim())) merged[merged.length - 1] = prev + s;
    else merged.push(s);
  }
  return merged.map((s) => s.trim()).filter(Boolean);
}

export function toSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  splitParagraphs(text).forEach((para, p) => {
    for (const s of segmentSentences(para)) {
      for (const piece of splitLong(s)) out.push({ p, text: piece });
    }
  });
  return out;
}

export function wordCount(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

/** Baseline narration speed of most system voices at rate 1.0. */
export const BASE_WPM = 165;

export function listenMinutes(words: number, rate: number): number {
  return words / (BASE_WPM * Math.max(rate, 0.1));
}

export function formatDuration(minutes: number): string {
  if (!isFinite(minutes) || minutes <= 0) return "0m";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h ${m}m` : `${Math.max(m, 1)}m`;
}

/** Rough words left to hear, from the saved sentence position (~18 words per sentence). */
export function remainingWords(r: { wordCount: number; position: number; completed: boolean }): number {
  if (r.completed) return 0;
  return Math.max(0, r.wordCount - r.position * 18);
}
