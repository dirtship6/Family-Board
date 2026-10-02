import { useMemo, useState } from "react";
import { playOrder, useStore } from "../store";
import { answerFromPassages, expandQuery, generateBrief, type ShortAnswer } from "../lib/claude";
import { noteFromAI, noteFromReading } from "../lib/notes";
import { retrieve, type Passage } from "../lib/retrieve";
import { buildIndex } from "../lib/search";
import { BudgetBanner } from "./Costs";
import type { Reading } from "../lib/types";

type Tab = "brief" | "ask";

function BriefPanel() {
  const { readings, nowPlaying, settings, saveReading, open, go } = useStore();
  const ordered = playOrder(readings);
  const [id, setId] = useState(nowPlaying?.id ?? ordered[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reading = readings.find((r) => r.id === id);
  const b = reading?.brief;

  const run = async (r: Reading) => {
    setBusy(true);
    setError("");
    try {
      const brief = await generateBrief(settings.apiKey, r);
      await saveReading({ ...r, brief });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  return (
    <div>
      <p className="muted">
        Read the brief before you listen so you know what to listen for, or after to lock it in.
      </p>
      <div className="row">
        <select className="grow" value={id} onChange={(e) => setId(e.target.value)}>
          {ordered.map((r) => (
            <option key={r.id} value={r.id}>
              {r.course} — {r.title}
              {r.brief ? " ✓" : ""}
            </option>
          ))}
        </select>
        {reading && (
          <button className="primary" disabled={busy} onClick={() => void run(reading)}>
            {busy ? "Working…" : b ? "Regenerate" : "Generate brief"}
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {reading && b && (
        <div className="brief">
          <h3>BLUF</h3>
          <p>{b.bluf}</p>
          <h3>Thesis</h3>
          <p>{b.thesis}</p>
          <h3>Key arguments</h3>
          <ul>{b.keyArguments.map((x, i) => <li key={i}>{x}</li>)}</ul>
          <h3>Key terms</h3>
          <dl>
            {b.keyTerms.map((t, i) => (
              <div key={i}>
                <dt>{t.term}</dt>
                <dd>{t.definition}</dd>
              </div>
            ))}
          </dl>
          <h3>Connections</h3>
          <ul>{b.connections.map((x, i) => <li key={i}>{x}</li>)}</ul>
          <h3>Likely to be tested</h3>
          <ul>{b.likelyTested.map((x, i) => <li key={i}>{x}</li>)}</ul>
          <h3>Seminar questions</h3>
          <ol>{b.discussionQuestions.map((x, i) => <li key={i}>{x}</li>)}</ol>
          <button
            onClick={() => {
              open(reading, true);
              go("listen");
            }}
          >
            ▶ Listen to this reading
          </button>
        </div>
      )}
    </div>
  );
}

interface AskResult {
  id: string;
  question: string;
  scope: string;
  passages: Passage[];
  searched: number;
  result?: ShortAnswer;
  error?: string;
}

function AnswerCard({ r }: { r: AskResult }) {
  const { readings, open, go, saveNote, showToast } = useStore();
  const byN = new Map(r.passages.map((p) => [p.n, p]));
  const jump = (p: Passage) => {
    const reading = readings.find((x) => x.id === p.readingId);
    if (!reading) return;
    open(reading, false, p.focus);
    go("listen");
  };
  const chip = (n: number) => {
    const p = byN.get(n);
    if (!p) return null;
    return (
      <button key={n} className="source-chip" title={`${p.title} — open at this passage`} onClick={() => jump(p)}>
        {n} · {p.title.length > 28 ? `${p.title.slice(0, 26)}…` : p.title}
      </button>
    );
  };

  const saveAnswer = async () => {
    if (!r.result) return;
    const cite = (ns: number[]) => [...new Set(ns.map((n) => byN.get(n)?.title).filter(Boolean))].join("; ");
    const text = [r.result.answer, ...r.result.points.map((pt) => `- ${pt.point}${pt.sources.length ? ` (${cite(pt.sources)})` : ""}`)].join("\n");
    const used = [...new Set(r.passages.map((p) => p.course))];
    await saveNote(noteFromAI(r.question, text, used.length === 1 ? used[0] : "General", [...new Set(r.passages.map((p) => p.title))]));
    showToast("Answer saved to notes");
  };

  const saveQuote = async (p: Passage) => {
    const reading = readings.find((x) => x.id === p.readingId);
    if (!reading) return;
    await saveNote(noteFromReading(reading, buildIndex([reading])[0].sentences, p.sentenceStart, p.sentenceEnd));
    showToast("Passage saved to notes");
  };

  return (
    <div className="answer">
      <div className="answer-q">
        <span className="muted small">{r.scope} ·</span> {r.question}
      </div>
      {r.error && <p className="error">{r.error}</p>}
      {!r.error && !r.result && (
        <p className="muted">{r.passages.length ? `Reading ${r.passages.length} relevant passages…` : "Searching your readings…"}</p>
      )}
      {r.result && (
        <>
          {r.result.coverage !== "answered" && (
            <div className={r.result.coverage === "not_found" ? "notice warn" : "notice"}>
              {r.result.coverage === "not_found"
                ? "Not found in the matching passages. Try other wording, widen the scope, or check the reading directly."
                : "Partial answer: the matching passages only cover part of this."}
            </div>
          )}
          <p className="answer-bluf">{r.result.answer}</p>
          {r.result.points.length > 0 && (
            <ul className="answer-points">
              {r.result.points.map((pt, i) => (
                <li key={i}>
                  {pt.point} <span className="chips">{pt.sources.map(chip)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="row wrap">
            <button onClick={() => void saveAnswer()}>☆ Save answer to notes</button>
            <span className="muted small">
              {r.passages.length} passages from {new Set(r.passages.map((p) => p.readingId)).size} of {r.searched} readings
            </span>
          </div>
        </>
      )}
      {r.passages.length > 0 && (
        <details>
          <summary>Passages used</summary>
          {r.passages.map((p) => (
            <div key={p.n} className="hit">
              <div className="muted small">
                [{p.n}] {p.title} · {p.course}
              </div>
              <p className="hit-text">{p.text}</p>
              <div className="hit-actions">
                <button onClick={() => jump(p)}>Read in context</button>
                <button onClick={() => void saveQuote(p)}>☆ Save passage</button>
              </div>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

function AskPanel() {
  const { readings, settings, nowPlaying } = useStore();
  const [scope, setScope] = useState(""); // "" = everything, "course:<name>", or "reading:<id>"
  const [question, setQuestion] = useState("");
  const [results, setResults] = useState<AskResult[]>([]);
  const busy = results.some((r) => !r.result && !r.error);
  const courses = useMemo(() => [...new Set(readings.map((r) => r.course))].sort(), [readings]);

  const update = (id: string, patch: Partial<AskResult>) =>
    setResults((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const ask = async () => {
    const q = question.trim();
    if (!q) return;
    const id = crypto.randomUUID();
    const label = scope.startsWith("course:")
      ? scope.slice(7)
      : scope.startsWith("reading:")
        ? readings.find((r) => r.id === scope.slice(8))?.title ?? "This reading"
        : "All readings";
    setResults((prev) => [{ id, question: q, scope: label, passages: [], searched: 0 }, ...prev].slice(0, 8));
    try {
      let index = buildIndex(readings);
      if (scope.startsWith("reading:")) index = index.filter((r) => r.id === scope.slice(8));
      const course = scope.startsWith("course:") ? scope.slice(7) : undefined;
      // Expansion only improves recall; if it fails, search with the question's own words.
      const terms = await expandQuery(settings.apiKey, q).catch(() => []);
      const { passages, searched } = retrieve(index, q, terms, { course });
      update(id, { passages, searched });
      if (!passages.length) {
        update(id, { result: { answer: "Nothing in your readings matched this question.", points: [], coverage: "not_found" } });
        return;
      }
      update(id, { result: await answerFromPassages(settings.apiKey, q, passages) });
    } catch (e) {
      update(id, { error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div>
      <p className="muted">
        Ask a question in plain English. It finds the most relevant passages across your readings and gives a short,
        sourced answer. Tap a source to jump to that spot.
      </p>
      <div className="row wrap">
        <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Search scope">
          <option value="">All readings</option>
          {courses.map((c) => (
            <option key={c} value={`course:${c}`}>{c}</option>
          ))}
          {nowPlaying && <option value={`reading:${nowPlaying.id}`}>Now playing: {nowPlaying.title}</option>}
        </select>
      </div>
      <div className="row ask-row">
        <textarea
          className="grow"
          rows={2}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!busy) void ask();
            }
          }}
          placeholder="e.g. How does Warden define strategic paralysis?"
        />
        <button className="primary" disabled={!question.trim() || busy || !readings.length} onClick={() => void ask()}>
          {busy ? "Working…" : "Ask"}
        </button>
      </div>
      {!readings.length && <p className="empty">Import readings in the Library first.</p>}
      {results.map((r) => <AnswerCard key={r.id} r={r} />)}
    </div>
  );
}

export function Study() {
  const { settings, go } = useStore();
  const [tab, setTab] = useState<Tab>("brief");
  return (
    <section>
      <h1>Study</h1>
      {!settings.apiKey && (
        <p className="notice">
          The study tools use Claude. <button className="link" onClick={() => go("settings")}>Add your API key in Settings</button>.
        </p>
      )}
      <BudgetBanner />
      <div className="subtabs">
        {(
          [
            ["brief", "Reading briefs"],
            ["ask", "Ask the readings"],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="card">
        {tab === "brief" && <BriefPanel />}
        {tab === "ask" && <AskPanel />}
      </div>
    </section>
  );
}
