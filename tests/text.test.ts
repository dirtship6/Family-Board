import { describe, expect, it } from "vitest";
import { cleanText, formatDuration, listenMinutes, remainingWords, splitParagraphs, toSentences, wordCount } from "../src/lib/text";

describe("text", () => {
  it("joins words hyphenated across lines and collapses whitespace", () => {
    expect(cleanText("air-\npower   is\r\n\r\n\r\n\r\nkey")).toBe("airpower is\n\nkey");
  });

  it("splits paragraphs on blank lines and unwraps single line breaks", () => {
    expect(splitParagraphs("one\ntwo\n\nthree")).toEqual(["one two", "three"]);
  });

  it("does not break sentences after military ranks or common abbreviations", () => {
    const s = toSentences("Gen. Billy Mitchell argued for airpower. Col. John Boyd, i.e. the OODA guy, disagreed. The end!");
    expect(s.map((x) => x.text)).toEqual([
      "Gen. Billy Mitchell argued for airpower.",
      "Col. John Boyd, i.e. the OODA guy, disagreed.",
      "The end!",
    ]);
  });

  it("tracks paragraph index per sentence", () => {
    const s = toSentences("First. Second.\n\nThird.");
    expect(s.map((x) => x.p)).toEqual([0, 0, 1]);
  });

  it("splits run-on text into speakable chunks", () => {
    const long = Array.from({ length: 120 }, (_, i) => `clause ${i}`).join(", ");
    const parts = toSentences(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.text.length <= 320)).toBe(true);
    expect(parts.map((p) => p.text).join(" ").replace(/\s+/g, " ")).toBe(long);
  });

  it("estimates listening time", () => {
    expect(wordCount(" a b  c ")).toBe(3);
    expect(listenMinutes(330, 2)).toBeCloseTo(1);
    expect(formatDuration(135)).toBe("2h 15m");
    expect(formatDuration(0.2)).toBe("1m");
    expect(remainingWords({ wordCount: 1000, position: 10, completed: false })).toBe(820);
    expect(remainingWords({ wordCount: 1000, position: 10, completed: true })).toBe(0);
  });
});
