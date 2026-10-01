// Chicago / Turabian notes-bibliography formatting (the AU Style Guide default).
import type { Reading } from "./types";

function splitName(full: string): { first: string; last: string } {
  const name = full.trim();
  if (name.includes(",")) {
    const [last, first] = name.split(",", 2).map((s) => s.trim());
    return { first, last };
  }
  const parts = name.split(/\s+/);
  const last = parts.pop() ?? "";
  return { first: parts.join(" "), last };
}

function authors(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/\s*(?:;|\band\b|&)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function bibAuthors(raw: string | undefined): string {
  const list = authors(raw);
  if (!list.length) return "";
  const [first, ...rest] = list;
  const { first: f, last: l } = splitName(first);
  const lead = f ? `${l}, ${f}` : l;
  const others = rest.map((a) => {
    const n = splitName(a);
    return `${n.first} ${n.last}`.trim();
  });
  if (!others.length) return lead;
  if (others.length === 1) return `${lead}, and ${others[0]}`;
  return `${lead}, ${others.slice(0, -1).join(", ")}, and ${others[others.length - 1]}`;
}

function noteAuthors(raw: string | undefined): string {
  const list = authors(raw).map((a) => {
    const n = splitName(a);
    return `${n.first} ${n.last}`.trim();
  });
  if (list.length <= 2) return list.join(" and ");
  if (list.length === 3) return `${list[0]}, ${list[1]}, and ${list[2]}`;
  return `${list[0]} et al.`;
}

function endPeriod(s: string): string {
  return /[.?!]$/.test(s) ? s : `${s}.`;
}

/** Bibliography entry, e.g. `Boyd, John. *Title*. Publisher, 1987.` (italics as *…*). */
export function bibliography(r: Pick<Reading, "title" | "author" | "publisher" | "year" | "url">): string {
  const parts: string[] = [];
  const a = bibAuthors(r.author);
  if (a) parts.push(endPeriod(a));
  parts.push(endPeriod(`*${r.title.trim()}*`));
  const pub = [r.publisher?.trim(), r.year?.trim()].filter(Boolean).join(", ");
  if (pub) parts.push(endPeriod(pub));
  if (r.url?.trim()) parts.push(endPeriod(r.url.trim()));
  return parts.join(" ");
}

/** First full footnote. `page` is optional. */
export function footnote(
  r: Pick<Reading, "title" | "author" | "publisher" | "year" | "url">,
  page?: string,
): string {
  const a = noteAuthors(r.author);
  const pub = [r.publisher?.trim(), r.year?.trim()].filter(Boolean).join(", ");
  let note = a ? `${a}, *${r.title.trim()}*` : `*${r.title.trim()}*`;
  if (pub) note += ` (${pub})`;
  if (page?.trim()) note += `, ${page.trim()}`;
  if (r.url?.trim() && !pub) note += `, ${r.url.trim()}`;
  return endPeriod(note);
}

/** Subsequent short-form note: `Boyd, *Short Title*, 12.` */
export function shortNote(r: Pick<Reading, "title" | "author">, page?: string): string {
  const first = authors(r.author)[0];
  const last = first ? splitName(first).last : "";
  const shortTitle = r.title.split(/[:.?]/)[0].split(/\s+/).slice(0, 4).join(" ");
  let note = last ? `${last}, *${shortTitle}*` : `*${shortTitle}*`;
  if (page?.trim()) note += `, ${page.trim()}`;
  return endPeriod(note);
}

export function bibliographyList(readings: Reading[]): string {
  return readings
    .map((r) => bibliography(r))
    .sort((a, b) => a.localeCompare(b))
    .join("\n\n");
}
