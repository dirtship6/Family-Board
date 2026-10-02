import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import * as db from "../lib/db";
import { PAPER_ACTIONS, runPaperAction, type PaperAction } from "../lib/claude";
import { bibliographyList, footnote, shortNote } from "../lib/citations";
import { wordCount } from "../lib/text";
import type { Paper } from "../lib/types";
import { Markdown } from "./Markdown";
import { ReadingPicker } from "./ReadingPicker";
import { BudgetBanner } from "./Costs";

function blankPaper(): Paper {
  return {
    id: db.newId(),
    title: "New paper",
    course: "",
    prompt: "",
    rubric: "",
    wordTarget: 2000,
    thesis: "",
    outline: "",
    draft: "",
    sourceIds: [],
    coaching: {},
    updatedAt: Date.now(),
  };
}

function CitationHelper({ paper }: { paper: Paper }) {
  const { readings } = useStore();
  const sources = readings.filter((r) => paper.sourceIds.includes(r.id));
  const [id, setId] = useState(sources[0]?.id ?? "");
  const [page, setPage] = useState("");
  const src = sources.find((r) => r.id === id);
  const missing = sources.filter((r) => !r.author || !r.year);
  const copy = (t: string) => void navigator.clipboard?.writeText(t.replace(/\*/g, ""));
  if (!sources.length) return <p className="muted">Select sources above to build footnotes and a bibliography.</p>;
  return (
    <div>
      {missing.length > 0 && (
        <p className="notice small">
          Missing author or year for: {missing.map((r) => r.title).join("; ")}. Fill them in under Library → Edit.
        </p>
      )}
      <div className="row">
        <select className="grow" value={id} onChange={(e) => setId(e.target.value)}>
          {sources.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
        </select>
        <input style={{ width: 90 }} value={page} onChange={(e) => setPage(e.target.value)} placeholder="page(s)" />
      </div>
      {src && (
        <div className="cites">
          <div><span className="muted small">First note</span><Markdown text={footnote(src, page)} /><button onClick={() => copy(footnote(src, page))}>Copy</button></div>
          <div><span className="muted small">Short note</span><Markdown text={shortNote(src, page)} /><button onClick={() => copy(shortNote(src, page))}>Copy</button></div>
        </div>
      )}
      <h4>Bibliography</h4>
      <Markdown text={bibliographyList(sources)} />
      <button onClick={() => copy(bibliographyList(sources))}>Copy bibliography</button>
      <p className="muted small">Italics are shown as *asterisks* in copied text; apply italics in Word. Verify against the AU Style and Author Guide.</p>
    </div>
  );
}

function PaperEditor({ paper, onPatch }: { paper: Paper; onPatch(patch: Partial<Paper>): void }) {
  const { readings, settings, go } = useStore();
  const [action, setAction] = useState<PaperAction | null>(null);
  const [live, setLive] = useState("");
  const [error, setError] = useState("");
  const set = onPatch;
  const words = wordCount(paper.draft);
  const pct = paper.wordTarget ? Math.min(100, (words / paper.wordTarget) * 100) : 0;

  const run = async (a: PaperAction) => {
    setAction(a);
    setLive("");
    setError("");
    try {
      const sources = readings.filter((r) => paper.sourceIds.includes(r.id));
      const out = await runPaperAction(settings.apiKey, a, paper, sources, setLive);
      // Merge against the latest copy so edits made while the coach was writing are kept.
      onPatch({ coaching: { [a]: out } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setAction(null);
  };

  const [shown, setShown] = useState<PaperAction>("decode");
  const output = action === shown ? live : paper.coaching[shown];

  return (
    <div className="paper">
      <div className="card">
        <div className="grid2">
          <label>Title<input value={paper.title} onChange={(e) => set({ title: e.target.value })} /></label>
          <label>Course<input value={paper.course} onChange={(e) => set({ course: e.target.value })} /></label>
          <label>Word target<input type="number" value={paper.wordTarget} onChange={(e) => set({ wordTarget: Number(e.target.value) })} /></label>
          <label>Due<input type="date" value={paper.due ?? ""} onChange={(e) => set({ due: e.target.value })} /></label>
        </div>
        <label>Assignment prompt<textarea rows={4} value={paper.prompt} onChange={(e) => set({ prompt: e.target.value })} placeholder="Paste the assignment prompt" /></label>
        <label>Rubric<textarea rows={3} value={paper.rubric} onChange={(e) => set({ rubric: e.target.value })} placeholder="Paste the grading rubric" /></label>
        <details>
          <summary>Sources ({paper.sourceIds.length} selected)</summary>
          <ReadingPicker selected={paper.sourceIds} onChange={(ids) => set({ sourceIds: ids })} />
        </details>
      </div>

      <div className="two-col">
        <div className="card">
          <label>Thesis<textarea rows={3} value={paper.thesis} onChange={(e) => set({ thesis: e.target.value })} placeholder="Your one-sentence, arguable answer to the prompt" /></label>
          <label>Outline<textarea rows={8} value={paper.outline} onChange={(e) => set({ outline: e.target.value })} placeholder={"I. Intro + thesis\nII. …\nIII. …\nIV. Conclusion / so what"} /></label>
          <label>
            Draft{" "}
            <span className="muted small">
              {words.toLocaleString()} / {paper.wordTarget.toLocaleString()} words
            </span>
            <div className="meter"><div style={{ width: `${pct}%` }} /></div>
            <textarea className="draft" rows={18} value={paper.draft} onChange={(e) => set({ draft: e.target.value })} placeholder="Write here, or paste from Word to get feedback" />
          </label>
        </div>

        <div className="card">
          <h3>Writing coach</h3>
          {!settings.apiKey && (
            <p className="notice small">
              <button className="link" onClick={() => go("settings")}>Add your API key</button> to use the coach.
            </p>
          )}
          <div className="coach-actions">
            {(Object.keys(PAPER_ACTIONS) as PaperAction[]).map((a) => (
              <button
                key={a}
                className={shown === a ? "active" : ""}
                title={PAPER_ACTIONS[a].hint}
                onClick={() => setShown(a)}
              >
                {PAPER_ACTIONS[a].label}
                {paper.coaching[a] ? " ✓" : ""}
              </button>
            ))}
          </div>
          <p className="muted small">{PAPER_ACTIONS[shown].hint}</p>
          <button className="primary" disabled={!!action} onClick={() => void run(shown)}>
            {action === shown ? "Working…" : paper.coaching[shown] ? "Run again" : "Run"}
          </button>
          {error && <p className="error">{error}</p>}
          {output && <Markdown text={output} />}
          <hr />
          <h3>Citations</h3>
          <CitationHelper paper={paper} />
        </div>
      </div>
    </div>
  );
}

export function Papers() {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const timers = useRef(new Map<string, number>());

  useEffect(() => {
    void db.all("papers").then((p) => setPapers(p.sort((a, b) => b.updatedAt - a.updatedAt)));
  }, []);

  const patch = (id: string, change: Partial<Paper>) => {
    setPapers((prev) =>
      prev.map((x) => {
        if (x.id !== id) return x;
        const next = { ...x, ...change, coaching: { ...x.coaching, ...change.coaching }, updatedAt: Date.now() };
        window.clearTimeout(timers.current.get(id));
        timers.current.set(id, window.setTimeout(() => void db.put("papers", next), 600));
        return next;
      }),
    );
  };

  const active = useMemo(() => papers.find((p) => p.id === activeId) ?? null, [papers, activeId]);

  if (active) {
    return (
      <section>
        <button className="link" onClick={() => setActiveId(null)}>← All papers</button>
        <h1>{active.title}</h1>
        <BudgetBanner />
        <PaperEditor paper={active} onPatch={(c) => patch(active.id, c)} />
      </section>
    );
  }

  return (
    <section>
      <h1>Papers</h1>
      <p className="muted">
        A workspace per assignment: decode the prompt, pressure-test your thesis, organize evidence from your readings,
        get instructor-style feedback on your draft, and build Chicago-style citations.
      </p>
      <button
        className="primary"
        onClick={async () => {
          const p = blankPaper();
          await db.put("papers", p);
          setPapers((prev) => [p, ...prev]);
          setActiveId(p.id);
        }}
      >
        + New paper
      </button>
      <ul className="list">
        {papers.map((p) => (
          <li key={p.id} className="row">
            <div className="grow">
              <div className="strong">{p.title}</div>
              <div className="muted small">
                {p.course && `${p.course} · `}
                {wordCount(p.draft).toLocaleString()}/{p.wordTarget} words
                {p.due && ` · due ${p.due}`}
              </div>
            </div>
            <button onClick={() => setActiveId(p.id)}>Open</button>
            <button
              className="danger"
              onClick={async () => {
                if (!confirm(`Delete “${p.title}”?`)) return;
                await db.remove("papers", p.id);
                setPapers((prev) => prev.filter((x) => x.id !== p.id));
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
