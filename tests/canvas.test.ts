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
