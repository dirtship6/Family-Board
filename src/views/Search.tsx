import { useDeferredValue, useMemo, useState, type ReactNode } from "react";
import { useStore } from "../store";
import { buildIndex, highlightRanges, parseQuery, search, type IndexedReading } from "../lib/search";
import { footnote } from "../lib/citations";
import { noteFromReading } from "../lib/notes";

function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  const ranges = highlightRanges(text, terms);
  const out: ReactNode[] = [];
  let last = 0;
  ranges.forEach(([a, b], i) => {
    if (a > last) out.push(text.slice(last, a));
    out.push(<mark key={i}>{text.slice(a, b)}</mark>);
    last = b;
  });
  out.push(text.slice(last));
  return <>{out}</>;
}

export function Search() {
  const { readings, open, go, saveNote, deleteNote, showToast } = useStore();
  const [query, setQuery] = useState(() => sessionStorage.getItem("acsc-speedrun.search") ?? "");
  const [course, setCourse] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState("");
  const deferred = useDeferredValue(query);

  const index = useMemo(() => buildIndex(readings), [readings]);

  const courses = useMemo(() => [...new Set(readings.map((r) => r.course))].sort(), [readings]);
  const terms = useMemo(() => parseQuery(deferred), [deferred]);
  const results = useMemo(() => search(index, deferred, { course: course || undefined }), [index, deferred, course]);

  const jump = (readingId: string, sentenceIndex: number, play: boolean) => {
    const r = readings.find((x) => x.id === readingId);
    if (!r) return;
    open(r, play, sentenceIndex);
    go("listen");
  };

  const copyQuote = (readingId: string, text: string) => {
    const r = readings.find((x) => x.id === readingId);
    if (!r) return;
    void navigator.clipboard?.writeText(`“${text}”\n${footnote(r).replace(/\*/g, "")}`);
    setCopied(`${readingId}:${text}`);
    setTimeout(() => setCopied(""), 1500);
  };

  const saveHit = async (ir: IndexedReading, sentenceIndex: number) => {
    const r = readings.find((x) => x.id === ir.id);
    if (!r) return;
    const n = noteFromReading(r, ir.sentences, sentenceIndex);
    await saveNote(n);
    showToast("Saved to notes", { label: "Undo", run: () => void deleteNote(n.id) });
  };

  return (
    <section>
      <h1>Search</h1>
      <div className="row wrap search-bar">
        <input
          className="grow"
          type="search"
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            sessionStorage.setItem("acsc-speedrun.search", e.target.value);
          }}
          placeholder='Search all readings — e.g. center of gravity, "mission command", Warden'
        />
        <select value={course} onChange={(e) => setCourse(e.target.value)} aria-label="Course">
          <option value="">All courses</option>
          {courses.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      <p className="muted small">
        Every word must appear in the same sentence. Use "quotes" for exact phrases.
        {terms.length > 0 &&
          ` ${results.total.toLocaleString()} match${results.total === 1 ? "" : "es"} in ${results.groups.length} reading${results.groups.length === 1 ? "" : "s"}${results.truncated ? " (showing first 500)" : ""}.`}
      </p>

      {!readings.length && <p className="empty">Import readings in the Library to search them.</p>}

      {results.groups.map(({ reading: r, hits }) => {
        const isOpen = expanded.has(r.id) || results.groups.length === 1;
        const shown = isOpen ? hits : hits.slice(0, 3);
        return (
          <div key={r.id} className="card hit-group">
            <h2>
              {r.title} <span className="muted small">{r.course} · {hits.length} hit{hits.length === 1 ? "" : "s"}</span>
            </h2>
            {shown.map((h) => {
              const prev = r.sentences[h.sentenceIndex - 1];
              const cur = r.sentences[h.sentenceIndex];
              const next = r.sentences[h.sentenceIndex + 1];
              return (
                <div key={h.sentenceIndex} className="hit">
                  <p className="hit-text">
                    {prev && prev.p === cur.p && <span className="muted">{prev.text} </span>}
                    <Highlighted text={cur.text} terms={terms} />
                    {next && next.p === cur.p && <span className="muted"> {next.text}</span>}
                  </p>
                  <div className="hit-actions">
                    <button onClick={() => jump(r.id, h.sentenceIndex, false)}>Read in context</button>
                    <button onClick={() => jump(r.id, h.sentenceIndex, true)}>▶ Listen from here</button>
                    <button onClick={() => void saveHit(r, h.sentenceIndex)}>☆ Save to notes</button>
                    <button onClick={() => copyQuote(r.id, cur.text)}>
                      {copied === `${r.id}:${cur.text}` ? "Copied ✓" : "Copy quote + footnote"}
                    </button>
                  </div>
                </div>
              );
            })}
            {hits.length > 3 && results.groups.length > 1 && (
              <button
                className="link"
                onClick={() =>
                  setExpanded((s) => {
                    const n = new Set(s);
                    if (n.has(r.id)) n.delete(r.id);
                    else n.add(r.id);
                    return n;
                  })
                }
              >
                {isOpen ? "Show fewer" : `Show all ${hits.length}`}
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}
