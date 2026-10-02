import { describe, expect, it } from "vitest";
import { classifyParagraphs, isCitationEntry, isSymbolNoise, repairLigatures, speakable, toSpokenSentences } from "../src/lib/listening";

const prose = (n: number, topic = "leadership") =>
  Array.from({ length: n }, (_, i) => `Paragraph ${i} explains how ${topic} develops through education, training, and experience over a full career, and why deliberate reflection matters for every officer who wants to grow.`).join("\n\n");

describe("speakable", () => {
  it("drops author-year citations, footnote numbers, bracket refs, and URLs", () => {
    expect(speakable("Culture is contested (Barley, Meyer, and Gash, 1988; Martin, 1991; Ott, 1989), as many note.")).toBe("Culture is contested, as many note.");
    expect(speakable("Leaders matter (see Northouse 2013, p. 161) in every unit.")).toBe("Leaders matter in every unit.");
    expect(speakable("Toxic leaders persist in our military.1 The Navy relieved several.")).toBe("Toxic leaders persist in our military. The Navy relieved several.");
    expect(speakable("Bold leaders are heroic1 (to use Janowitz's term) at times.")).toBe("Bold leaders are heroic (to use Janowitz's term) at times.");
    expect(speakable("Prior work [3, 7-9] agrees; see https://doi.org/10.1002/cc.440 for details.")).toBe("Prior work agrees; see for details.");
  });

  it("keeps ordinary numbers and parentheticals", () => {
    expect(speakable("Phase 2 lasted 18 months (roughly a year and a half).")).toBe("Phase 2 lasted 18 months (roughly a year and a half).");
    expect(speakable("In 1948, AFM 35-15 said leadership is an art.")).toBe("In 1948, AFM 35-15 said leadership is an art.");
  });
});

describe("isCitationEntry", () => {
  it("recognizes APA, Chicago, and numbered note entries", () => {
    expect(isCitationEntry("Ackerman, P. L., & Kanfer, R. (2004). Cognitive, affective, and conative aspects of adult intellect.")).toBe(true);
    expect(isCitationEntry("12. Daniel Goleman, “What makes a leader?” in Harvard Business Review (Harvard Business School Press, 2005).")).toBe(true);
    expect(isCitationEntry("14. Ibid.")).toBe(true);
    expect(isCitationEntry("Leadership is the art of influencing people to accomplish the mission.")).toBe(false);
  });
});

describe("classifyParagraphs", () => {
  it("skips a references section after its heading, through to where prose resumes", () => {
    const text = [
      prose(8),
      "References",
      "Ackerman, P. L., & Kanfer, R. (2004). Cognitive aspects of adult\nintellect. In D. Y. Dai (Eds.), Motivation (pp. 119-141). Mahwah, NJ: Routledge.",
      "intellect within a typical framework (pp. 1-9). Journal of Things, 3(2).",
      "Amabile, T. M. (2005). Affect and creativity at work. Administrative Science Quarterly, 50, 367–403.",
    ].join("\n\n");
    const kinds = classifyParagraphs(text);
    expect(kinds.slice(0, 8).every((k) => k === null)).toBe(true);
    expect(kinds.slice(8)).toEqual(["references", "references", "references", "references"]);
  });

  it("handles a heading that starts the same paragraph as the notes", () => {
    const text = [prose(10), "Notes\n1. Ronald A. Heifetz, Leadership without Easy Answers (Cambridge, MA: Belknap Press, 1994), 16–18.\n2. Ibid., 21."].join("\n\n");
    expect(classifyParagraphs(text).at(-1)).toBe("references");
    expect(classifyParagraphs(text).slice(0, 10).every((k) => k === null)).toBe(true);
  });

  it("skips endnotes printed before their heading at the very end", () => {
    const text = [
      prose(8),
      "11. Travis Bradberry and Jean Greaves, Emotional Intelligence 2.0 (San Francisco: Publishers Group West, 2009).\n12. Daniel Goleman, “What makes a leader?” (Harvard Business School Press, 2005).",
      "13. Bradberry and Greaves.\n14. Ibid.\n15. Bruce Avolio, Leadership Development in Balance (Mahwah, NJ: Erlbaum, 2005).",
      "NOTES",
    ].join("\n\n");
    expect(classifyParagraphs(text).slice(-3)).toEqual(["references", "references", "references"]);
  });

  it("does not treat a numbered list of prose at the end as notes", () => {
    const text = [prose(8), "1. Describe the communication process.\nCommunication is the process by which a sender transmits information to a receiver.", "2. Identify barriers.\nNoise, jargon, and overload all get in the way of understanding."].join("\n\n");
    expect(classifyParagraphs(text).every((k) => k === null)).toBe(true);
  });

  it("flags flattened tables but not narrow-column prose", () => {
    const table = ["Table 8.1 Phases in Leadership Making", "Phase 1", "Stranger", "Phase 2", "Acquaintance", "Phase 3", "Partnership", "Roles", "Scripted", "Tested"].join("\n");
    const glossary = ["communication The process by", "which a person, group, or", "organization (the sender)", "transmits some type of", "information (the message) to", "another person (the receiver)."].join("\n");
    const kinds = classifyParagraphs([prose(4), table, glossary].join("\n\n"));
    expect(kinds[4]).toBe("table");
    expect(kinds[5]).toBe(null);
  });
});

describe("toSpokenSentences", () => {
  it("marks skipped sentences and cleans the rest, or passes text through when off", () => {
    const text = [prose(6), "Leaders matter (Northouse, 2013).", "References", "Northouse, P. G. (2013). Leadership: Theory and practice. Sage.", "Yukl, G. (2010). Leadership in organizations. Pearson."].join("\n\n");
    const on = toSpokenSentences(text, true);
    expect(on.find((s) => s.text.startsWith("Leaders matter"))!.speak).toBe("Leaders matter.");
    expect(on.filter((s) => s.skip === "references").length).toBeGreaterThanOrEqual(3);
    const off = toSpokenSentences(text, false);
    expect(off.every((s) => !s.skip && s.speak === s.text)).toBe(true);
  });
});

describe("repairLigatures", () => {
  const library = [
    "The officer found the difficulty of defining. We find it hard to find. Find it. The officer found the difficulty of defining effective leadership. There they said this, that, these, those, then first five officers. "
      .repeat(5),
  ];
  it("repairs a document with dropped ligatures using the library as a dictionary", () => {
    const damaged = "Te ofcer fnd the difculty of defning efective leadership. Tere tey said tis and tat. Te frst fve ofcers. Te end. ".repeat(3);
    const { text, fixes } = repairLigatures(damaged, library);
    expect(text).toContain("The officer find the difficulty of defining effective leadership. There they said this and that.");
    expect(fixes).toBeGreaterThan(20);
  });

  it("leaves normal documents untouched, including rare real words", () => {
    const normal = "Ten soldiers found the officer. The difficulty was defining it. Te Deum was sung once.";
    expect(repairLigatures(normal, library)).toEqual({ text: normal, fixes: 0 });
  });
});

describe("isSymbolNoise", () => {
  it("flags logo debris but not short real text", () => {
    expect(isSymbolNoise("~~c;,f/ ZurichuzH")).toBe(true);
    expect(isSymbolNoise("•  •  •  —  §")).toBe(true);
    expect(isSymbolNoise("University of")).toBe(false);
    expect(isSymbolNoise("Year: 2021")).toBe(false);
    expect(isSymbolNoise("Phase 1 – Stranger")).toBe(false);
  });
});
