import { describe, expect, it } from "vitest";
import { describeFile, emptyModules, extractRefs, parseCourseData, stripBoilerplate } from "../src/lib/canvas";

describe("canvas export", () => {
  it("parses course-data.js without evaluating it", () => {
    const js = 'window.COURSE_DATA = {"title":"LDR-601S","modules":[{"name":"Lesson 1","items":[]}]};\n';
    expect(parseCourseData(js).title).toBe("LDR-601S");
    expect(() => parseCourseData("alert(1)")).toThrow();
  });

  it("extracts local files, outside links and videos in page order, deduplicated", () => {
    const html = `
      <p><a href="viewer/files/Lesson_1/L1_Reading%20PDFs/pdf_Schein,%20Defining%20Culture%20(2010).pdf?canvas_=1&amp;canvas_qs_wrap=1"><img src="viewer/files/icons/x.png"></a></p>
      <iframe src="https://www.youtube.com/embed/pYKH2uSax8U?rel=0?modestbranding=1"></iframe>
      <a href="https://mwi.westpoint.edu/article">The <em>Changing</em> Character</a>
      <a href="viewer/files/Lesson_1/L1_Reading%20PDFs/pdf_Schein,%20Defining%20Culture%20(2010).pdf">again</a>
      <a href="https://community.canvaslms.com/help">help</a>
      <iframe src="https://embed.ted.com/talks/simon_sinek_how_great_leaders_inspire_action"></iframe>`;
    expect(extractRefs(html)).toEqual([
      { path: "viewer/files/Lesson_1/L1_Reading PDFs/pdf_Schein, Defining Culture (2010).pdf", label: "viewer/files/Lesson_1/L1_Reading PDFs/pdf_Schein, Defining Culture (2010).pdf".split("/").pop(), kind: "file" },
      { url: "https://www.youtube.com/watch?v=pYKH2uSax8U", label: "Video 1 (YouTube)", kind: "video" },
      { url: "https://mwi.westpoint.edu/article", label: "The Changing Character", kind: "link" },
      { url: "https://embed.ted.com/talks/simon_sinek_how_great_leaders_inspire_action", label: "TED: simon sinek how great leaders inspire action", kind: "video" },
    ]);
  });

  it("turns export file names into citation-ready titles", () => {
    expect(describeFile("pdf_Coleman, Military Ethics_An Introduction with Case Studies (2013) p1-7.pdf")).toEqual({
      title: "Military Ethics: An Introduction with Case Studies", author: "Coleman", year: "2013",
    });
    expect(describeFile("pdf_Strand, Ethical Reasoning and Military Leadership (nd).pdf")).toEqual({
      title: "Ethical Reasoning and Military Leadership", author: "Strand", year: undefined,
    });
    expect(describeFile("LDR-601S Syllabus 29 Jan 2025.pdf")).toEqual({ title: "LDR-601S Syllabus 29 Jan 2025" });
  });

  it("flags modules that downloaded without content", () => {
    expect(emptyModules({ title: "x", modules: [
      { name: "Lesson 1", items: [{ title: "p", type: "WikiPage", content: "<p>hi</p>" }] },
      { name: "Lesson 2", items: [{ title: "p", type: "WikiPage", content: "" }, { title: "q", type: "Quizzes::Quiz" }] },
      { name: "Wrap-up", items: [{ title: "x", type: "ExternalUrl" }] },
    ] })).toEqual(["Lesson 2"]);
  });

  it("drops Canvas boilerplate lines", () => {
    expect(stripBoilerplate('Be sure to click "Mark as Done" at the bottom of this page.\nWelcome!')).toBe("Welcome!");
  });
});

describe("file names without a year", () => {
  it("still separates the author and drops page ranges and version stamps", () => {
    expect(describeFile("pdf_Ivcevic, Supervisor Emotionally Intelligent Behavior and Employee Creativity.pdf")).toEqual({
      title: "Supervisor Emotionally Intelligent Behavior and Employee Creativity", author: "Ivcevic", year: undefined,
    });
    expect(describeFile("pdf_Greenberg, Communication in Organizations (2008) p333-337, 362-372.pdf")).toMatchObject({ title: "Communication in Organizations", year: "2008" });
    expect(describeFile("MyVector PathFinder Visual_10Apr26.pdf")).toEqual({ title: "MyVector PathFinder Visual" });
  });
});

import { matchAssignments } from "../src/lib/canvas";
import { inferPageNumbers, parseAssignedPages, unassignedPages, detectPrintedNumber } from "../src/lib/pages";

describe("reading assignments", () => {
  const page = [
    "REQUIRED MATERIAL",
    "The Air Force (2021) Read 1-16",
    "Consider as you read: AFDP 1 provides a foundational starting point.",
    "Supervisor Emotionally Intelligent Behavior and Employee Creativity (2021) Read pages 2-11, 16-22, 35-38",
    "On Character and Servant Leadership: Ten Characteristics of Effective, Caring Leaders (2002) Read pages 25-30",
    "Nature and Scope of Toxic Leadership (2015) Read chapter 1",
  ].join("\n");

  it("matches each document to its lesson instruction by title", () => {
    expect(
      matchAssignments(page, ["The Air Force", "Supervisor Emotionally Intelligent Behavior and Employee Creativity", "On Character and Servant Leadership", "Nature and Scope of Toxic Leadership", "Defining Organizational Culture"]),
    ).toEqual(["Read 1-16", "Read pages 2-11, 16-22, 35-38", "Read pages 25-30", "Read chapter 1", undefined]);
  });

  it("parses page ranges and ignores non-page instructions", () => {
    expect(parseAssignedPages("Read pages 334-335 and 364-365")).toEqual([[334, 335], [364, 365]]);
    expect(parseAssignedPages('Read pages 1 ("The Art of Leadership") and 4-7 ("The AWC Model")')).toEqual([[1, 1], [4, 7]]);
    expect(parseAssignedPages("Read 1-16")).toEqual([[1, 16]]);
    expect(parseAssignedPages("Read chapter 1")).toBe(null);
    expect(parseAssignedPages("Read Section 1 (Overview) p3; Section 3 p4-5")).toBe(null);
  });

  it("reads printed page numbers from page edges", () => {
    expect(detectPrintedNumber(["Chapter 8 Leader–Member Exchange Theory 163", "Body text."])).toBe(163);
    expect(detectPrintedNumber(["Body text here.", "More body.", "334"])).toBe(334);
    expect(detectPrintedNumber(["182 Leadership: Theory and Practice", "Body."])).toBe(182);
    expect(detectPrintedNumber(["In 2021, 14,645 employees answered.", "Body text."])).toBe(null);
  });

  it("trusts only page numbers that agree, and fills gaps across a jump", () => {
    // Greenberg: two excerpts (333-337, 362-372) with a few unnumbered pages; a stray chapter number "8".
    const detected = [8, 333, 334, 335, null, 337, 362, 363, null, 365];
    const nums = inferPageNumbers(detected);
    expect(nums.map((p) => p.n)).toEqual([332, 333, 334, 335, 336, 337, 362, 363, 364, 365]);
    expect(nums[0].sure).toBe(false);
    expect(nums[8].sure).toBe(false);
  });

  it("skips unassigned pages but keeps unnumbered pages next to assigned ones", () => {
    const nums = inferPageNumbers([null, 333, 334, 335, null, 337, 362, 363, null, 365, 366, 367]);
    const skip = unassignedPages(nums, [[334, 335], [364, 365]])!;
    // 333 skipped; 336 (unnumbered, after 335) kept; 337, 362, 363 skipped; 364 (unnumbered) kept as assigned.
    expect(skip).toEqual([true, true, false, false, false, true, true, true, false, false, true, true]);
  });

  it("refuses to guess when numbering is unreliable or doesn't match", () => {
    expect(unassignedPages(inferPageNumbers([null, 17, null, null]), [[1, 1], [4, 7]])).toBe(null);
    expect(unassignedPages(inferPageNumbers([1, 2, 3, 4]), [[99, 106]])).toBe(null);
  });
});
