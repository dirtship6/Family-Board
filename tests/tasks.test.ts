import { describe, expect, it } from "vitest";
import { parseTaskLines } from "../src/views/Tasks";

describe("parseTaskLines", () => {
  it("parses date, course, and kind in any order", () => {
    const [a, b] = parseTaskLines("2026-10-14 | Airpower | quiz | Lesson 3 quiz\nLeadership | paper | Reflection paper");
    expect(a).toMatchObject({ due: "2026-10-14", course: "Airpower", kind: "quiz", title: "Lesson 3 quiz" });
    expect(b).toMatchObject({ due: undefined, course: "Leadership", kind: "paper", title: "Reflection paper" });
  });
});
