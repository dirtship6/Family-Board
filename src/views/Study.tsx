import { useEffect, useMemo, useState } from "react";
import { playOrder, useStore } from "../store";
import { askAboutReadings, generateBrief, generateQuiz } from "../lib/claude";
import * as db from "../lib/db";
import type { QuizAttempt, QuizQuestion, Reading } from "../lib/types";
import { Markdown } from "./Markdown";
import { ReadingPicker } from "./ReadingPicker";

type Tab = "brief" | "quiz" | "review" | "ask";

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

function QuizRunner({ attempt, onSave }: { attempt: QuizAttempt; onSave(a: QuizAttempt): void }) {
  const [i, setI] = useState(() => {
    const firstOpen = attempt.answers.findIndex((a) => a === null);
    return firstOpen < 0 ? 0 : firstOpen;
  });
  const q = attempt.questions[i];
  const chosen = attempt.answers[i];
  const correct = attempt.answers.filter((a, k) => a === attempt.questions[k].answerIndex).length;
  const answered = attempt.answers.filter((a) => a !== null).length;

  if (attempt.finished) {
    return (
      <div className="quiz">
        <h3>
          Score: {correct}/{attempt.questions.length} ({Math.round((correct / attempt.questions.length) * 100)}%)
        </h3>
        {attempt.questions.map((qq, k) => {
          const ok = attempt.answers[k] === qq.answerIndex;
          return (
            <div key={k} className={ok ? "result ok" : "result miss"}>
              <div className="strong">{ok ? "✓" : "✗"} {qq.question}</div>
              {!ok && (
                <div className="small">
                  You: {attempt.answers[k] !== null ? qq.choices[attempt.answers[k]!] : "—"} · Correct: {qq.choices[qq.answerIndex]}
                </div>
              )}
              <div className="small muted">{qq.explanation}</div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="quiz">
      <div className="muted small">
        Question {i + 1} of {attempt.questions.length} · {q.sourceTitle} · {correct}/{answered} correct so far
      </div>
      <h3>{q.question}</h3>
      <div className="choices">
        {q.choices.map((c, k) => {
          let cls = "choice";
          if (chosen !== null) {
            if (k === q.answerIndex) cls += " correct";
            else if (k === chosen) cls += " wrong";
          }
          return (
            <button
              key={k}
              className={cls}
              disabled={chosen !== null}
              onClick={() => {
                const answers = attempt.answers.slice();
                answers[i] = k;
                onSave({ ...attempt, answers });
              }}
            >
              <span className="letter">{String.fromCharCode(65 + k)}</span> {c}
            </button>
          );
        })}
      </div>
      {chosen !== null && <div className="explanation">{q.explanation}</div>}
      <div className="actions">
        <button disabled={i === 0} onClick={() => setI(i - 1)}>← Back</button>
        {i < attempt.questions.length - 1 ? (
          <button className="primary" disabled={chosen === null} onClick={() => setI(i + 1)}>Next →</button>
        ) : (
          <button className="primary" disabled={chosen === null} onClick={() => onSave({ ...attempt, finished: true })}>
            Finish
          </button>
        )}
      </div>
    </div>
  );
}

function QuizPanel({ reviewOnly }: { reviewOnly?: boolean }) {
  const { readings, settings, nowPlaying } = useStore();
  const [selected, setSelected] = useState<string[]>(nowPlaying ? [nowPlaying.id] : []);
  const [count, setCount] = useState(10);
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attempts, setAttempts] = useState<QuizAttempt[]>([]);
  const [active, setActive] = useState<QuizAttempt | null>(null);

  useEffect(() => {
    void db.all("quizzes").then((a) => setAttempts(a.sort((x, y) => y.createdAt - x.createdAt)));
  }, []);

  const save = async (a: QuizAttempt) => {
    setActive(a);
    setAttempts((prev) => [a, ...prev.filter((x) => x.id !== a.id)]);
    await db.put("quizzes", a);
  };

  const start = (questions: QuizQuestion[], readingIds: string[]) =>
    save({
      id: db.newId(),
      createdAt: Date.now(),
      readingIds,
      questions,
      answers: questions.map(() => null),
      finished: false,
    });

  const missed = useMemo(() => {
    const seen = new Set<string>();
    const out: QuizQuestion[] = [];
    for (const a of attempts) {
      a.questions.forEach((q, k) => {
        if (a.answers[k] !== null && a.answers[k] !== q.answerIndex && !seen.has(q.question)) {
          seen.add(q.question);
          out.push(q);
        }
      });
    }
    return out;
  }, [attempts]);

  if (active) {
    return (
      <div>
        <button className="link" onClick={() => setActive(null)}>← All quizzes</button>
        <QuizRunner key={active.id} attempt={active} onSave={(a) => void save(a)} />
      </div>
    );
  }

  if (reviewOnly) {
    return (
      <div>
        <p className="muted">
          Every question you've missed across practice quizzes, deduplicated. Drill these until they stick.
        </p>
        {missed.length ? (
          <button className="primary" onClick={() => void start([...missed].sort(() => Math.random() - 0.5).slice(0, 25), [])}>
            Drill {Math.min(missed.length, 25)} missed questions
          </button>
        ) : (
          <p className="empty">No missed questions yet.</p>
        )}
      </div>
    );
  }

  const generate = async () => {
    setBusy(true);
    setError("");
    try {
      const chosen = readings.filter((r) => selected.includes(r.id));
      const qs = await generateQuiz(settings.apiKey, chosen, count, focus);
      await start(qs, selected);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  return (
    <div>
      <p className="muted">
        Practice quizzes built from your readings, with explanations. Use them to find gaps before the graded quiz.
      </p>
      <ReadingPicker selected={selected} onChange={setSelected} />
      <div className="row">
        <label>
          Questions
          <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[5, 10, 15, 20, 30].map((n) => <option key={n}>{n}</option>)}
          </select>
        </label>
        <label className="grow">
          Focus (optional)
          <input value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="e.g. definitions, Warden vs. Boyd, the learning objectives" />
        </label>
      </div>
      <button className="primary" disabled={!selected.length || busy} onClick={() => void generate()}>
        {busy ? "Writing quiz…" : `Generate ${count}-question quiz`}
      </button>
      {error && <p className="error">{error}</p>}
      {attempts.length > 0 && (
        <>
          <h3>History</h3>
          <ul className="list">
            {attempts.map((a) => {
              const correct = a.answers.filter((x, k) => x === a.questions[k].answerIndex).length;
              const titles = readings.filter((r) => a.readingIds.includes(r.id)).map((r) => r.title);
              return (
                <li key={a.id} className="row">
                  <div className="grow">
                    <div className="strong">{titles.length ? titles.join(", ") : "Missed-question drill"}</div>
                    <div className="muted small">
                      {new Date(a.createdAt).toLocaleString()} · {a.finished ? `${correct}/${a.questions.length}` : "in progress"}
                    </div>
                  </div>
                  <button onClick={() => setActive(a)}>{a.finished ? "Review" : "Resume"}</button>
                  <button
                    onClick={() => void start(a.questions, a.readingIds)}
                    title="Retake the same questions"
                  >
                    Retake
                  </button>
                </li>
              );
            })}
          </ul>
        </>
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
            ["quiz", "Practice quizzes"],
            ["review", "Missed questions"],
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
        {tab === "quiz" && <QuizPanel />}
        {tab === "review" && <QuizPanel reviewOnly />}
        {tab === "ask" && <AskPanel />}
      </div>
    </section>
  );
}
