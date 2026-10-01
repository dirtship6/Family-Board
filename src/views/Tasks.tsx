import { useEffect, useMemo, useState } from "react";
import * as db from "../lib/db";
import type { Task, TaskKind } from "../lib/types";

const KINDS: TaskKind[] = ["reading", "quiz", "paper", "exam", "discussion", "other"];

export function daysUntil(due: string | undefined): number | null {
  if (!due) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${due}T00:00:00`);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

export function dueLabel(due: string | undefined): { text: string; cls: string } {
  const d = daysUntil(due);
  if (d === null) return { text: "no date", cls: "muted" };
  if (d < 0) return { text: `${-d}d overdue`, cls: "overdue" };
  if (d === 0) return { text: "today", cls: "soon" };
  if (d === 1) return { text: "tomorrow", cls: "soon" };
  return { text: `in ${d}d`, cls: d <= 3 ? "soon" : "muted" };
}

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  useEffect(() => {
    void db.all("tasks").then(setTasks);
  }, []);
  const save = async (t: Task) => {
    await db.put("tasks", t);
    setTasks((prev) => [...prev.filter((x) => x.id !== t.id), t]);
  };
  const remove = async (id: string) => {
    await db.remove("tasks", id);
    setTasks((prev) => prev.filter((x) => x.id !== id));
  };
  return { tasks, save, remove };
}

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort(
    (a, b) =>
      Number(a.done) - Number(b.done) ||
      (a.due ?? "9999").localeCompare(b.due ?? "9999") ||
      a.createdAt - b.createdAt,
  );
}

/** Parses one task per line: "2026-10-14 | Airpower | quiz | Lesson 3 quiz" (date, course and kind optional). */
export function parseTaskLines(text: string, now = Date.now()): Task[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line, i) => {
      const parts = line.split("|").map((p) => p.trim());
      let due: string | undefined;
      let course = "";
      let kind: TaskKind = "other";
      const title = parts.pop() ?? line;
      for (const p of parts) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(p)) due = p;
        else if ((KINDS as string[]).includes(p.toLowerCase())) kind = p.toLowerCase() as TaskKind;
        else course = p;
      }
      return { id: db.newId(), title, course, kind, due, done: false, createdAt: now + i };
    });
}

export function Tasks() {
  const { tasks, save, remove } = useTasks();
  const [title, setTitle] = useState("");
  const [course, setCourse] = useState("");
  const [kind, setKind] = useState<TaskKind>("reading");
  const [due, setDue] = useState("");
  const [bulk, setBulk] = useState("");
  const [showDone, setShowDone] = useState(false);

  const sorted = useMemo(() => sortTasks(tasks).filter((t) => showDone || !t.done), [tasks, showDone]);

  return (
    <section>
      <h1>Tasks</h1>
      <div className="card">
        <div className="row wrap">
          <input className="grow" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task (e.g. Lesson 4 quiz)" />
          <input value={course} onChange={(e) => setCourse(e.target.value)} placeholder="Course" style={{ width: 140 }} />
          <select value={kind} onChange={(e) => setKind(e.target.value as TaskKind)}>
            {KINDS.map((k) => <option key={k}>{k}</option>)}
          </select>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          <button
            className="primary"
            disabled={!title.trim()}
            onClick={async () => {
              await save({ id: db.newId(), title: title.trim(), course: course.trim(), kind, due: due || undefined, done: false, createdAt: Date.now() });
              setTitle("");
            }}
          >
            Add
          </button>
        </div>
        <details>
          <summary>Bulk add from your syllabus / schedule</summary>
          <p className="muted small">One per line: <code>2026-10-14 | Airpower | quiz | Lesson 3 quiz</code>. Date, course, and type are optional.</p>
          <textarea rows={6} value={bulk} onChange={(e) => setBulk(e.target.value)} />
          <button
            disabled={!bulk.trim()}
            onClick={async () => {
              for (const t of parseTaskLines(bulk)) await save(t);
              setBulk("");
            }}
          >
            Add all
          </button>
        </details>
      </div>
      <label className="toggle">
        <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show completed
      </label>
      <ul className="list">
        {sorted.map((t) => {
          const d = dueLabel(t.due);
          return (
            <li key={t.id} className="row">
              <input type="checkbox" checked={t.done} onChange={(e) => void save({ ...t, done: e.target.checked })} />
              <div className="grow">
                <div className={t.done ? "strong done" : "strong"}>{t.title}</div>
                <div className="small">
                  <span className={`chip ${t.kind}`}>{t.kind}</span> {t.course && <span className="muted">{t.course} · </span>}
                  <span className={d.cls}>{t.due ? `${t.due} (${d.text})` : d.text}</span>
                </div>
              </div>
              <button className="danger" onClick={() => void remove(t.id)}>✕</button>
            </li>
          );
        })}
      </ul>
      {!sorted.length && <p className="empty">No open tasks.</p>}
    </section>
  );
}
