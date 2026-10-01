import { describe, expect, it } from "vitest";
import { retrieve, stem, tokenize } from "../src/lib/retrieve";
import { indexReading } from "../src/lib/search";

const filler = (n: number) => Array.from({ length: n }, (_, i) => `Routine logistics sentence ${i} about supply depots and fuel.`).join(" ");
const index = [
  indexReading({ id: "w", course: "Airpower", title: "Warden", text: `${filler(30)} Strategic paralysis results from striking leadership at the center of the five rings. ${filler(30)}` }),
  indexReading({ id: "c", course: "Strategy", title: "Clausewitz", text: `War is the continuation of politics. ${filler(10)} The center of gravity is the hub of all power.` }),
  indexReading({ id: "l", course: "Leadership", title: "Mission Command", text: filler(20) }),
];

describe("retrieve", () => {
  it("tokenizes without stopwords and stems lightly", () => {
    const toks = tokenize("How does Warden explain the paralysis of operations?");
    expect(toks).toHaveLength(3);
    expect(toks[1]).toBe("paralysis");
    expect(stem("operations")).toBe(stem("operation"));
    expect(stem("operational")).toBe(stem("operation"));
    expect(stem("wars")).toBe("wars");
  });

  it("finds the passage that answers the question", () => {
    const { passages } = retrieve(index, "What causes strategic paralysis?");
    expect(passages[0].readingId).toBe("w");
    expect(passages[0].text).toContain("Strategic paralysis results");
    expect(passages[0].n).toBe(1);
    // Jumping lands on the matching sentence, not the start of the window.
    expect(index[0].sentences[passages[0].focus].text).toMatch(/^Strategic paralysis/);
  });

  it("uses expansion terms to find related wording", () => {
    const without = retrieve(index, "decisive point of an enemy");
    expect(without.passages.some((p) => p.readingId === "c")).toBe(false);
    const withTerms = retrieve(index, "decisive point of an enemy", ["center of gravity", "hub of power"]);
    expect(withTerms.passages[0].readingId).toBe("c");
  });

  it("respects the course filter and returns nothing for unrelated questions", () => {
    expect(retrieve(index, "strategic paralysis", [], { course: "Strategy" }).passages.every((p) => p.course === "Strategy")).toBe(true);
    expect(retrieve(index, "submarine sonar acoustics").passages).toEqual([]);
  });

  it("caps passages per reading and avoids overlapping windows", () => {
    const { passages } = retrieve(index, "logistics supply fuel depots", [], { perReading: 2, limit: 10 });
    const counts = passages.reduce<Record<string, number>>((m, p) => ({ ...m, [p.readingId]: (m[p.readingId] ?? 0) + 1 }), {});
    expect(Math.max(...Object.values(counts))).toBeLessThanOrEqual(2);
    for (const a of passages) for (const b of passages) if (a !== b && a.readingId === b.readingId) expect(a.sentenceEnd < b.sentenceStart || b.sentenceEnd < a.sentenceStart).toBe(true);
  });
});
