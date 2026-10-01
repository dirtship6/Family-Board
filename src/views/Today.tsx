import { useMemo } from "react";
import { playOrder, useStore } from "../store";
import { formatDuration, listenMinutes, remainingWords } from "../lib/text";
import { daysUntil, dueLabel, sortTasks, useTasks } from "./Tasks";

export function Today() {
  const { readings, settings, open, go, nowPlaying, playing, narrator } = useStore();
  const { tasks, save } = useTasks();

  const stats = useMemo(() => {
    const done = readings.filter((r) => r.completed).length;
    const words = readings.reduce((n, r) => n + remainingWords(r), 0);
    const minutes = listenMinutes(words, settings.rate);
    const days = daysUntil(settings.targetDate);
    const perDay = days && days > 0 ? minutes / days : null;
    return { done, total: readings.length, minutes, days, perDay };
  }, [readings, settings.rate, settings.targetDate]);

  const next = useMemo(() => playOrder(readings).find((r) => !r.completed), [readings]);
  const resume = nowPlaying && !nowPlaying.completed ? nowPlaying : next;
  const upcoming = sortTasks(tasks).filter((t) => !t.done).slice(0, 6);

  return (
    <section>
      <h1>Today</h1>
      <div className="stats">
        <div className="stat">
          <div className="n">{stats.total ? Math.round((stats.done / stats.total) * 100) : 0}%</div>
          <div className="l">readings done ({stats.done}/{stats.total})</div>
        </div>
        <div className="stat">
          <div className="n">{formatDuration(stats.minutes)}</div>
          <div className="l">listening left at {settings.rate}×</div>
        </div>
        <div className="stat">
          <div className="n">{stats.perDay !== null ? formatDuration(stats.perDay) : "—"}</div>
          <div className="l">
            {stats.perDay !== null ? (
              `per day to finish by ${settings.targetDate}`
            ) : (
              <button className="link" onClick={() => go("settings")}>set a finish date</button>
            )}
          </div>
        </div>
      </div>

      {resume ? (
        <div className="card hero">
          <div className="muted small">{nowPlaying?.id === resume.id ? "Now playing" : "Up next"} · {resume.course}</div>
          <h2>{resume.title}</h2>
          <div className="muted small">
            {formatDuration(listenMinutes(remainingWords(resume), settings.rate))} left · then auto-continues through your queue
          </div>
          <div className="actions">
            <button
              className="primary big"
              onClick={() => {
                if (nowPlaying?.id === resume.id) narrator.toggle();
                else open(resume, true);
              }}
            >
              {nowPlaying?.id === resume.id && playing ? "❚❚ Pause" : "▶ Listen"}
            </button>
            <button onClick={() => { if (nowPlaying?.id !== resume.id) open(resume); go("listen"); }}>Follow along</button>
            <button onClick={() => go("study")}>Brief &amp; Q&amp;A</button>
          </div>
        </div>
      ) : (
        <div className="card">
          <h2>Get started</h2>
          <ol>
            <li><button className="link" onClick={() => go("library")}>Import your readings</button> (PDF, Word, web pages, or pasted text), grouped by course.</li>
            <li><button className="link" onClick={() => go("tasks")}>Paste your schedule</button> of quizzes and paper deadlines.</li>
            <li><button className="link" onClick={() => go("settings")}>Pick a voice and speed</button>, and add an API key for the study tools.</li>
          </ol>
        </div>
      )}

      <div className="card">
        <h2>Upcoming <button className="link small" onClick={() => go("tasks")}>all tasks →</button></h2>
        {upcoming.length ? (
          <ul className="list">
            {upcoming.map((t) => {
              const d = dueLabel(t.due);
              return (
                <li key={t.id} className="row">
                  <input type="checkbox" checked={t.done} onChange={(e) => void save({ ...t, done: e.target.checked })} />
                  <div className="grow">
                    <span className="strong">{t.title}</span>{" "}
                    <span className={`chip ${t.kind}`}>{t.kind}</span>{" "}
                    <span className="small muted">{t.course}</span>
                  </div>
                  <span className={`small ${d.cls}`}>{d.text}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">Nothing scheduled.</p>
        )}
      </div>
    </section>
  );
}
