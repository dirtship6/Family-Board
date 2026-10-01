import { footnote } from "./citations";
import { newId } from "./db";
import type { Sentence } from "./text";
import type { Note, Reading } from "./types";

function joinSentences(sentences: Sentence[], start: number, end: number): string {
  let out = "";
  for (let i = start; i <= end; i++) {
    const s = sentences[i];
    if (!s) continue;
    // Keep paragraph breaks when a quote spans paragraphs.
    out += out ? (sentences[i - 1]?.p === s.p ? " " : "\n\n") + s.text : s.text;
  }
  return out;
}

export function noteFromReading(
  reading: Reading,
  sentences: Sentence[],
  start: number,
  end = start,
  quote?: string,
): Note {
  return {
    id: newId(),
    createdAt: Date.now(),
    quote: quote?.trim() || joinSentences(sentences, start, end),
    comment: "",
    tags: [],
    course: reading.course,
    source: "reading",
    readingId: reading.id,
    readingTitle: reading.title,
    sentenceStart: start,
    sentenceEnd: end,
    citation: footnote(reading),
  };
}

export function noteFromAI(question: string, answer: string, course: string, readingTitles: string[]): Note {
  return {
    id: newId(),
    createdAt: Date.now(),
    quote: answer.trim(),
    comment: `Q: ${question.trim()}`,
    tags: ["ai"],
    course,
    source: "ai",
    readingTitle: readingTitles.join("; ") || undefined,
  };
}

/** Grow (or shrink) a reading note by one sentence at either end. */
export function widenNote(note: Note, sentences: Sentence[], edge: "start" | "end", delta: 1 | -1): Note {
  if (note.sentenceStart === undefined || note.sentenceEnd === undefined) return note;
  let start = note.sentenceStart;
  let end = note.sentenceEnd;
  if (edge === "start") start = Math.min(Math.max(0, start - delta), end);
  else end = Math.max(Math.min(sentences.length - 1, end + delta), start);
  if (start === note.sentenceStart && end === note.sentenceEnd) return note;
  return { ...note, sentenceStart: start, sentenceEnd: end, quote: joinSentences(sentences, start, end) };
}

export function parseTags(input: string): string[] {
  return [...new Set(input.split(/[,#]/).map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

/** Whole notebook as Markdown, grouped by course, oldest first within each course. */
export function notesToMarkdown(notes: Note[]): string {
  const byCourse = new Map<string, Note[]>();
  for (const n of [...notes].sort((a, b) => a.createdAt - b.createdAt)) {
    byCourse.set(n.course || "General", [...(byCourse.get(n.course || "General") ?? []), n]);
  }
  const lines: string[] = ["# ACSC Notebook", ""];
  for (const course of [...byCourse.keys()].sort()) {
    lines.push(`## ${course}`, "");
    for (const n of byCourse.get(course)!) {
      const date = new Date(n.createdAt).toISOString().slice(0, 10);
      lines.push(`### ${n.readingTitle ?? (n.source === "ai" ? "AI answer" : "Note")} (${date})`, "");
      lines.push(...n.quote.split("\n").map((l) => (n.source === "reading" ? `> ${l}` : l)), "");
      if (n.citation) lines.push(`— ${n.citation}`, "");
      if (n.comment.trim()) lines.push(`**My take:** ${n.comment.trim()}`, "");
      if (n.tags.length) lines.push(`Tags: ${n.tags.map((t) => `#${t}`).join(" ")}`, "");
    }
  }
  return lines.join("\n");
}
