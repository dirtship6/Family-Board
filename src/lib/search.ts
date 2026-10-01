// Full-text search across every reading, matched sentence by sentence so each
// hit can jump straight to that spot in the narration.
import { toSentences, type Sentence } from "./text";

export interface IndexedReading {
  id: string;
  course: string;
  title: string;
  sentences: Sentence[];
  /** Lowercased, accent-stripped copy of each sentence for matching. */
  folded: string[];
}

export interface SearchHit {
  readingId: string;
  sentenceIndex: number;
}

export interface ReadingHits {
  reading: IndexedReading;
  hits: SearchHit[];
}

export function fold(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase();
}

export function indexReading(r: { id: string; course: string; title: string; text: string }): IndexedReading {
  const sentences = toSentences(r.text);
  return { id: r.id, course: r.course, title: r.title, sentences, folded: sentences.map((s) => fold(s.text)) };
}

/** Splits a query into terms; "quoted phrases" stay together. */
export function parseQuery(q: string): string[] {
  const terms: string[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fold(q)))) {
    const t = (m[1] ?? m[2]).trim();
    if (t) terms.push(t);
  }
  return terms;
}

export function search(
  index: IndexedReading[],
  query: string,
  opts: { course?: string; limit?: number } = {},
): { groups: ReadingHits[]; total: number; truncated: boolean } {
  const terms = parseQuery(query);
  const limit = opts.limit ?? 500;
  if (!terms.length) return { groups: [], total: 0, truncated: false };
  const groups: ReadingHits[] = [];
  let total = 0;
  for (const r of index) {
    if (opts.course && r.course !== opts.course) continue;
    const titleMatch = terms.every((t) => fold(r.title).includes(t));
    const hits: SearchHit[] = [];
    r.folded.forEach((s, i) => {
      if (terms.every((t) => s.includes(t))) hits.push({ readingId: r.id, sentenceIndex: i });
    });
    if (!hits.length && titleMatch) hits.push({ readingId: r.id, sentenceIndex: 0 });
    if (hits.length) {
      groups.push({ reading: r, hits });
      total += hits.length;
    }
  }
  groups.sort((a, b) => b.hits.length - a.hits.length);
  let budget = limit;
  for (const g of groups) {
    g.hits = g.hits.slice(0, Math.max(budget, 0));
    budget -= g.hits.length;
  }
  return { groups: groups.filter((g) => g.hits.length), total, truncated: total > limit };
}

/** Character ranges of each term in `text`, merged, for highlighting. */
export function highlightRanges(text: string, terms: string[]): [number, number][] {
  const folded = fold(text);
  // fold() can change string length (ligatures); fall back to no highlight in that case.
  if (folded.length !== text.length) return [];
  const ranges: [number, number][] = [];
  for (const t of terms) {
    let from = 0;
    let i: number;
    while ((i = folded.indexOf(t, from)) >= 0) {
      ranges.push([i, i + t.length]);
      from = i + t.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}
