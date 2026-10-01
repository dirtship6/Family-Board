// Finds the passages most relevant to a question so only those go to Claude.
// Readings are cut into overlapping windows of a few sentences and ranked with BM25.
import { fold, type IndexedReading } from "./search";

export interface Passage {
  /** 1-based number Claude cites, e.g. [3]. */
  n: number;
  readingId: string;
  title: string;
  course: string;
  sentenceStart: number;
  sentenceEnd: number;
  /** The sentence inside the passage that best matches the question; where "jump to source" lands. */
  focus: number;
  text: string;
}

interface IndexedPassage {
  readingId: string;
  start: number;
  end: number;
  folded: string;
  tokens: Map<string, number>;
  length: number;
}

const STOPWORDS = new Set(
  ("a an and are as at be been but by can could did do does for from had has have how i if in into is it its " +
    "me my of on or our should so than that the their them then there these they this those to was we were what " +
    "when where which who whom why will with would you your about between does explain describe define compare " +
    "according author authors reading readings article text say says said tell discuss").split(" "),
);

/** Light stemming: enough to match "operations"/"operational"/"operate" without a dictionary. */
export function stem(word: string): string {
  let w = word;
  for (const suffix of ["ational", "ations", "ation", "ingly", "ings", "ing", "ness", "ments", "ment", "ies", "ed", "es", "ly", "al", "s"]) {
    if (suffix === "s" && /(ss|is|us)$/.test(w)) continue; // paralysis, mass, nexus
    if (w.length - suffix.length >= 4 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  return w;
}

export function tokenize(text: string): string[] {
  return (fold(text).match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? [])
    .map((t) => t.replace(/'s$/, ""))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

const WINDOW_WORDS = 110;

function buildPassages(r: IndexedReading): IndexedPassage[] {
  const out: IndexedPassage[] = [];
  const words = r.sentences.map((s) => s.text.split(/\s+/).length);
  let start = 0;
  while (start < r.sentences.length) {
    let end = start;
    let count = words[start];
    while (end + 1 < r.sentences.length && count < WINDOW_WORDS) count += words[++end];
    const folded = r.folded.slice(start, end + 1).join(" ");
    const tokens = new Map<string, number>();
    const toks = tokenize(folded);
    for (const t of toks) tokens.set(t, (tokens.get(t) ?? 0) + 1);
    out.push({ readingId: r.id, start, end, folded, tokens, length: toks.length });
    if (end + 1 >= r.sentences.length) break;
    // Overlap windows by about half so an idea split across a boundary is still found whole.
    start = Math.max(start + 1, Math.floor((start + end + 1) / 2));
  }
  return out;
}

const passageCache = new WeakMap<IndexedReading, IndexedPassage[]>();
function passagesFor(r: IndexedReading): IndexedPassage[] {
  let p = passageCache.get(r);
  if (!p) {
    p = buildPassages(r);
    passageCache.set(r, p);
  }
  return p;
}

function bestSentence(r: IndexedReading, p: IndexedPassage, weights: Map<string, number>, phrases: string[]): number {
  let best = p.start;
  let bestScore = -1;
  for (let i = p.start; i <= p.end; i++) {
    const toks = new Set(tokenize(r.folded[i]));
    let score = 0;
    for (const [t, w] of weights) if (toks.has(t)) score += w;
    for (const ph of phrases) if (r.folded[i].includes(ph)) score += 2;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return best;
}

export function retrieve(
  index: IndexedReading[],
  question: string,
  extraTerms: string[] = [],
  opts: { course?: string; limit?: number; perReading?: number } = {},
): { passages: Passage[]; searched: number } {
  const limit = opts.limit ?? 12;
  const perReading = opts.perReading ?? 4;
  const readings = index.filter((r) => !opts.course || r.course === opts.course);
  const pool = readings.flatMap((r) => passagesFor(r).map((p) => ({ p, r })));
  if (!pool.length) return { passages: [], searched: readings.length };

  // Question words count fully; expansion terms (synonyms, related concepts) count a bit less.
  const weights = new Map<string, number>();
  for (const t of tokenize(question)) weights.set(t, 1);
  const phrases: string[] = [];
  for (const term of extraTerms) {
    const toks = tokenize(term);
    if (toks.length > 1) phrases.push(fold(term).trim());
    for (const t of toks) if (!weights.has(t)) weights.set(t, 0.6);
  }
  for (const m of question.matchAll(/"([^"]+)"/g)) phrases.push(fold(m[1]).trim());
  if (!weights.size && !phrases.length) return { passages: [], searched: readings.length };

  const N = pool.length;
  const avgLen = pool.reduce((n, x) => n + x.p.length, 0) / N || 1;
  const df = new Map<string, number>();
  for (const t of weights.keys()) df.set(t, pool.reduce((n, x) => n + (x.p.tokens.has(t) ? 1 : 0), 0));
  const k1 = 1.2;
  const b = 0.75;

  const scored = pool
    .map(({ p, r }) => {
      let score = 0;
      let matched = 0;
      for (const [t, w] of weights) {
        const tf = p.tokens.get(t);
        if (!tf) continue;
        matched++;
        const idf = Math.log(1 + (N - df.get(t)! + 0.5) / (df.get(t)! + 0.5));
        score += w * idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * p.length) / avgLen)));
      }
      for (const ph of phrases) if (p.folded.includes(ph)) score += 3;
      // Favor passages that cover more of the question, not just one repeated word.
      score *= 1 + matched / Math.max(weights.size, 1);
      return { p, r, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, z) => z.score - a.score);

  const picked: typeof scored = [];
  const perCount = new Map<string, number>();
  for (const x of scored) {
    if (picked.length >= limit) break;
    const c = perCount.get(x.r.id) ?? 0;
    if (c >= perReading) continue;
    // Skip windows that mostly overlap one already chosen.
    if (picked.some((y) => y.r.id === x.r.id && x.p.start <= y.p.end && y.p.start <= x.p.end)) continue;
    perCount.set(x.r.id, c + 1);
    picked.push(x);
  }

  return {
    searched: readings.length,
    passages: picked.map(({ p, r }, i) => ({
      focus: bestSentence(r, p, weights, phrases),
      n: i + 1,
      readingId: r.id,
      title: r.title,
      course: r.course,
      sentenceStart: p.start,
      sentenceEnd: p.end,
      text: r.sentences.slice(p.start, p.end + 1).map((s) => s.text).join(" "),
    })),
  };
}
