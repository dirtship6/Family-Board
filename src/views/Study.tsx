import { useState } from "react";
import { playOrder, useStore } from "../store";
import { askAboutReadings, generateBrief } from "../lib/claude";
import type { Reading } from "../lib/types";
import { Markdown } from "./Markdown";
import { ReadingPicker } from "./ReadingPicker";

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

function AskPanel() {
  const { readings, settings, nowPlaying } = useStore();
  const [selected, setSelected] = useState<string[]>(nowPlaying ? [nowPlaying.id] : []);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ask = async () => {
    setBusy(true);
    setError("");
    setAnswer("");
    try {
      await askAboutReadings(settings.apiKey, readings.filter((r) => selected.includes(r.id)), question, setAnswer);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  return (
    <div>
      <p className="muted">Ask anything about one or more readings: compare authors, explain a concept, apply it to a scenario.</p>
      <ReadingPicker selected={selected} onChange={setSelected} />
      <textarea
        rows={3}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="e.g. How would Warden and Pape disagree about strategic bombing in Desert Storm?"
      />
      <button className="primary" disabled={!selected.length || !question.trim() || busy} onClick={() => void ask()}>
        {busy ? "Thinking…" : "Ask"}
      </button>
      {error && <p className="error">{error}</p>}
      {answer && <Markdown text={answer} />}
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
