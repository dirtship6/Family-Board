import { describe, expect, it } from "vitest";
import { bibliography, bibliographyList, footnote, shortNote } from "../src/lib/citations";

const book = { title: "The Air Campaign: Planning for Combat", author: "John A. Warden", publisher: "National Defense University Press", year: "1988" };

describe("citations", () => {
  it("formats a bibliography entry with last name first", () => {
    expect(bibliography(book)).toBe("Warden, John A. *The Air Campaign: Planning for Combat*. National Defense University Press, 1988.");
  });

  it("handles multiple authors", () => {
    expect(bibliography({ ...book, author: "Robert Pape; Phillip Meilinger" })).toMatch(/^Pape, Robert, and Phillip Meilinger\./);
    expect(footnote({ ...book, author: "Robert Pape; Phillip Meilinger" })).toMatch(/^Robert Pape and Phillip Meilinger,/);
  });

  it("formats first and short notes with pages", () => {
    expect(footnote(book, "45")).toBe("John A. Warden, *The Air Campaign: Planning for Combat* (National Defense University Press, 1988), 45.");
    expect(shortNote(book, "45")).toBe("Warden, *The Air Campaign*, 45.");
  });

  it("accepts 'Last, First' input and missing fields", () => {
    expect(bibliography({ title: "Untitled Memo", author: "Boyd, John" })).toBe("Boyd, John. *Untitled Memo*.");
    expect(bibliography({ title: "Web Piece", url: "https://example.mil/a" })).toBe("*Web Piece*. https://example.mil/a.");
  });

  it("sorts a bibliography alphabetically", () => {
    const list = bibliographyList([
      { ...book, id: "1" } as never,
      { title: "Science, Strategy and War", author: "Frans Osinga", publisher: "Routledge", year: "2007", id: "2" } as never,
    ]);
    expect(list.split("\n\n")[0]).toMatch(/^Osinga/);
  });
});
