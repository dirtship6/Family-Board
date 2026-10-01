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

import { stripRunningLines } from "../src/lib/text";
describe("stripRunningLines", () => {
  const WORDS = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa".split(" ");
  // Real prose differs in words between pages, not just in numbers.
  const body = (page: number) => Array.from({ length: 6 }, (_, j) => `The ${WORDS[(page * 6 + j) % 16]} ${WORDS[(page + j * 3) % 16]} leader acts.`);
  it("removes repeated headers, page numbers, and JSTOR stamps but keeps body text", () => {
    const pages = Array.from({ length: 6 }, (_, i) => [
      "Nature and Scope of Toxic Leadership",
      `This content downloaded from 10.0.0.${i} on Fri, 2 Feb 2024`,
      "All use subject to https://about.jstor.org/terms",
      ...body(i),
      "",
      String(i + 1),
    ]);
    const out = stripRunningLines(pages);
    expect(out[0]).toEqual([...body(0), ""]);
    expect(out[5]).toEqual([...body(5), ""]);
  });

  it("leaves short documents alone", () => {
    expect(stripRunningLines([["Title", "Text one."], ["Title", "Text two."]])).toEqual([["Title", "Text one."], ["Title", "Text two."]]);
  });
});
