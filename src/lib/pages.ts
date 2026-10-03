// Assigned page ranges: "Read pages 334-335 and 364-365" → only those printed pages are narrated.
// Printed page numbers come from the PDF itself and are trusted only when they agree with each other.

/** A printed page number found at the top or bottom of a page, or null. */
export function detectPrintedNumber(lines: string[]): number | null {
  const filled = lines.map((l) => l.trim()).filter(Boolean);
  const edges = [...filled.slice(0, 3), ...filled.slice(-3).reverse()];
  for (const l of edges) {
    let m = l.match(/^(?:page\s+)?(\d{1,3})$/i); // "163" or "Page 4"
    if (m) return Number(m[1]);
    m = l.match(/^(\d{1,3})\s+[A-Za-z•|].{2,90}$/); // "182 Leadership: Theory and Practice"
    if (m) return Number(m[1]);
    m = l.match(/^.{2,90}[A-Za-z|•]\s+(\d{1,3})$/); // "Chapter 8 Leader–Member Exchange Theory 183"
    if (m) return Number(m[1]);
  }
  return null;
}

export interface PageNumber {
  /** Printed page number for this PDF page, or null if unknown. */
  n: number | null;
  /** True when the number was printed on the page and agrees with other pages; false when inferred. */
  sure: boolean;
}

/**
 * Turns raw detections into a printed number per PDF page. A detection counts only if another page
 * agrees with it (same offset from its position); unnumbered pages take the nearest agreeing offset.
 * Every page is unknown when the document has no reliable numbering.
 */
export function inferPageNumbers(detected: (number | null)[]): PageNumber[] {
  const offsets = detected.map((d, i) => (d === null ? null : d - i));
  const support = new Map<number, number>();
  for (const o of offsets) if (o !== null) support.set(o, (support.get(o) ?? 0) + 1);
  const trusted = offsets.map((o) => (o !== null && (support.get(o) ?? 0) >= 2 ? o : null));
  if (!trusted.some((o) => o !== null)) return detected.map(() => ({ n: null, sure: false }));
  return detected.map((_, i) => {
    if (trusted[i] !== null) return { n: i + trusted[i]!, sure: true };
    // Nearest trusted page; prefer the one before (numbering usually continues forward).
    for (let k = 1; k < detected.length; k++) {
      if (i - k >= 0 && trusted[i - k] !== null) return { n: i + trusted[i - k]!, sure: false };
      if (i + k < detected.length && trusted[i + k] !== null) return { n: i + trusted[i + k]!, sure: false };
    }
    return { n: null, sure: false };
  });
}

export type PageRange = [number, number];

export type AssignmentStatus =
  | { kind: "partial"; instruction: string; pagesRead: number; pagesTotal: number; skipParas: Set<number> }
  | { kind: "all"; instruction: string; reason: "whole" | "unmatched" | "not-pages" };

/** What the lesson's instruction means for narrating this reading, or null when there's no instruction. */
export function assignmentStatus(r: {
  assignment?: string;
  pageStarts?: number[];
  pageNumbers?: PageNumber[];
}): AssignmentStatus | null {
  if (!r.assignment) return null;
  const instruction = r.assignment;
  const ranges = parseAssignedPages(instruction);
  if (!ranges) return { kind: "all", instruction, reason: "not-pages" };
  if (!r.pageStarts?.length || !r.pageNumbers?.length) return { kind: "all", instruction, reason: "unmatched" };
  const skip = unassignedPages(r.pageNumbers, ranges);
  if (!skip) return { kind: "all", instruction, reason: "unmatched" };
  if (!skip.some(Boolean)) return { kind: "all", instruction, reason: "whole" };
  const skipParas = new Set<number>();
  skip.forEach((s, i) => {
    if (!s) return;
    const from = r.pageStarts![i];
    const to = r.pageStarts![i + 1] ?? Number.MAX_SAFE_INTEGER;
    for (let p = from; p < to && p < from + 10_000; p++) skipParas.add(p);
  });
  return { kind: "partial", instruction, pagesRead: skip.filter((s) => !s).length, pagesTotal: skip.length, skipParas };
}

/**
 * Parses an instruction like "Read pages 2-11, 16-22, 35-38" or "Read pages 1 (“The Art”) and 4-7".
 * Returns null for instructions that aren't page ranges ("Read chapter 1", "Section 3").
 */
export function parseAssignedPages(instruction: string): PageRange[] | null {
  const m = instruction.match(/\b(?:read|pages?|pp?\.)\s*:?\s*(.*)$/i);
  if (!m) return null;
  const spec = m[1].replace(/\([^)]*\)/g, " ").replace(/["“”][^"“”]*["“”]/g, " ");
  if (/\b(chapter|section|attachment|appendix|skim)\b/i.test(spec)) return null;
  const ranges: PageRange[] = [];
  for (const r of spec.matchAll(/(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?/g)) {
    const a = Number(r[1]);
    const b = r[2] ? Number(r[2]) : a;
    if (b >= a) ranges.push([a, b]);
  }
  return ranges.length ? ranges : null;
}

/** Pages to leave out of narration (true = skip), or null when the assignment can't be matched safely. */
export function unassignedPages(numbers: PageNumber[], ranges: PageRange[]): boolean[] | null {
  if (!numbers.some((p) => p.sure)) return null;
  const inRange = (n: number | null) => n !== null && ranges.some(([a, b]) => n >= a && n <= b);
  // The assignment must land on pages whose numbers were actually printed in this document.
  if (!numbers.some((p) => p.sure && inRange(p.n))) return null;
  const assigned = numbers.map((p) => inRange(p.n));
  return numbers.map((p, i) => {
    if (assigned[i] || p.n === null) return false;
    // An unnumbered page right next to an assigned page might be its opening or closing page: keep it.
    if (!p.sure && (assigned[i - 1] || assigned[i + 1])) return false;
    return true;
  });
}
