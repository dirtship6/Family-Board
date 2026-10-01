import { describe, expect, it } from "vitest";
import { highlightRanges, indexReading, parseQuery, search } from "../src/lib/search";

const index = [
  indexReading({ id: "a", course: "Airpower", title: "Warden Rings", text: "Warden proposed five rings. Leadership sits at the center.\n\nThe center of gravity matters." }),
  indexReading({ id: "b", course: "Strategy", title: "Clausewitz", text: "The center of gravity is the hub of all power. War is politics by other means." }),
];

describe("search", () => {
  it("parses quoted phrases and folds case", () => {
    expect(parseQuery('Center "of Gravity"  hub')).toEqual(["center", "of gravity", "hub"]);
  });

  it("requires every term in the same sentence and ranks by hit count", () => {
    const r = search(index, "center gravity");
    expect(r.total).toBe(2);
    expect(r.groups.map((g) => g.reading.id).sort()).toEqual(["a", "b"]);
    expect(r.groups.find((g) => g.reading.id === "a")!.hits[0].sentenceIndex).toBe(2);
  });

  it("filters by course and matches phrases exactly", () => {
    expect(search(index, '"center of gravity"', { course: "Strategy" }).groups.map((g) => g.reading.id)).toEqual(["b"]);
    expect(search(index, '"gravity of center"').total).toBe(0);
  });

  it("matches titles when the text doesn't", () => {
    expect(search(index, "clausewitz").groups[0].reading.id).toBe("b");
  });

  it("caps results", () => {
    const r = search(index, "the", { limit: 1 });
    expect(r.truncated).toBe(true);
    expect(r.groups.reduce((n, g) => n + g.hits.length, 0)).toBe(1);
  });

  it("returns merged highlight ranges", () => {
    expect(highlightRanges("Center of the center", ["center", "cent"])).toEqual([[0, 6], [14, 20]]);
  });
});
