import { describe, expect, it } from "vitest";
import { noteFromReading, notesToMarkdown, parseTags, widenNote } from "../src/lib/notes";
import { toSentences } from "../src/lib/text";
import type { Reading } from "../src/lib/types";

const reading: Reading = {
  id: "r1", title: "The Air Campaign", course: "Airpower", order: 1, author: "John Warden", year: "1988",
  text: "One. Two. Three.\n\nFour. Five.", wordCount: 5, position: 0, completed: false, createdAt: 0,
};
const sentences = toSentences(reading.text);

describe("notes", () => {
  it("captures a sentence with a citation", () => {
    const n = noteFromReading(reading, sentences, 1);
    expect(n).toMatchObject({ quote: "Two.", course: "Airpower", readingId: "r1", sentenceStart: 1, sentenceEnd: 1 });
    expect(n.citation).toMatch(/^John Warden, \*The Air Campaign\*/);
  });

  it("widens and shrinks across paragraph breaks", () => {
    let n = noteFromReading(reading, sentences, 2);
    n = widenNote(n, sentences, "end", 1);
    expect(n.quote).toBe("Three.\n\nFour.");
    n = widenNote(n, sentences, "start", 1);
    expect(n.quote).toBe("Two. Three.\n\nFour.");
    n = widenNote(n, sentences, "end", -1);
    expect(n.quote).toBe("Two. Three.");
    const first = noteFromReading(reading, sentences, 0);
    expect(widenNote(first, sentences, "start", 1)).toBe(first);
  });

  it("parses tags", () => {
    expect(parseTags("#COG, deterrence ,cog")).toEqual(["cog", "deterrence"]);
  });

  it("exports markdown grouped by course", () => {
    const n = { ...noteFromReading(reading, sentences, 0), comment: "Key idea", tags: ["cog"] };
    const md = notesToMarkdown([n]);
    expect(md).toContain("## Airpower");
    expect(md).toContain("> One.");
    expect(md).toContain("**My take:** Key idea");
    expect(md).toContain("#cog");
  });
});
