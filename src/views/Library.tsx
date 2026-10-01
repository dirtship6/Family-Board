import { useMemo, useState } from "react";
import { playOrder, useStore } from "../store";
import { ACCEPTED_FILES, importAny, importUrl } from "../lib/importers";
import { newId } from "../lib/db";
import { cleanText, formatDuration, listenMinutes, remainingWords, wordCount } from "../lib/text";
import type { Reading } from "../lib/types";

function ReadingEditor({ reading, onDone }: { reading: Reading; onDone(): void }) {
  const { saveReading } = useStore();
  const [r, setR] = useState(reading);
  const set = (patch: Partial<Reading>) => setR((x) => ({ ...x, ...patch }));
  return (
    <div className="editor">
      <div className="grid2">
        <label>Title<input value={r.title} onChange={(e) => set({ title: e.target.value })} /></label>
        <label>Course / block<input value={r.course} onChange={(e) => set({ course: e.target.value })} /></label>
        <label>Author(s) <span className="muted small">separate with “;”</span><input value={r.author ?? ""} onChange={(e) => set({ author: e.target.value })} /></label>
        <label>Play order<input type="number" value={r.order} onChange={(e) => set({ order: Number(e.target.value) })} /></label>
        <label>Publisher / journal<input value={r.publisher ?? ""} onChange={(e) => set({ publisher: e.target.value })} /></label>
        <label>Year<input value={r.year ?? ""} onChange={(e) => set({ year: e.target.value })} /></label>
        <label className="span2">URL<input value={r.url ?? ""} onChange={(e) => set({ url: e.target.value })} /></label>
      </div>
      <label>
        Text <span className="muted small">(clean up headers, footers, or footnotes you don’t want read aloud)</span>
        <textarea rows={8} value={r.text} onChange={(e) => set({ text: e.target.value })} />
      </label>
      <div className="actions">
        <button
          className="primary"
          onClick={async () => {
            const text = cleanText(r.text);
            const changed = text !== reading.text;
            await saveReading({ ...r, text, wordCount: wordCount(text), position: changed ? 0 : r.position });
            onDone();
          }}
        >
          Save
        </button>
        <button onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

export function Library() {
  const { readings, saveReading, deleteReading, open, go, settings, nowPlaying } = useStore();
  const [course, setCourse] = useState(() => localStorage.getItem("acsc-speedrun.lastCourse") ?? "");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [url, setUrl] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const rememberCourse = (c: string) => {
    setCourse(c);
    localStorage.setItem("acsc-speedrun.lastCourse", c);
  };

  const nextOrder = (c: string) => {
    const inCourse = readings.filter((r) => r.course === c);
    return inCourse.length ? Math.max(...inCourse.map((r) => r.order)) + 1 : 1;
  };

  const add = async (title: string, text: string, extra: Partial<Reading> = {}) => {
    const c = course.trim() || "Unsorted";
    const reading: Reading = {
      id: newId(),
      title: title.trim() || "Untitled reading",
      course: c,
      order: nextOrder(c),
      text,
      wordCount: wordCount(text),
      position: 0,
      completed: false,
      createdAt: Date.now(),
      ...extra,
    };
    await saveReading(reading);
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError("");
    // `readings` won't refresh mid-loop, so track play order locally.
    let order = nextOrder(course.trim() || "Unsorted");
    let added = 0;
    const problems: string[] = [];
    for (const f of Array.from(files)) {
      setBusy(`Importing ${f.name}…`);
      try {
        const docs = (await importAny(f)).filter((d) => d.text.trim());
        if (!docs.length) throw new Error("no text found (scanned PDFs need OCR first)");
        for (const doc of docs) {
          setBusy(`Importing ${f.name}: ${doc.title}`);
          await add(doc.title, doc.text, { order: order++ });
          added++;
        }
      } catch (e) {
        problems.push(`${f.name}: ${e instanceof Error ? e.message : e}`);
      }
    }
    setBusy(added ? `Added ${added} reading${added === 1 ? "" : "s"}.` : "");
    setError(problems.join("\n"));
  };

  const onUrl = async () => {
    setError("");
    setBusy("Fetching…");
    try {
      const doc = await importUrl(url.trim());
      await add(doc.title, doc.text, { url: url.trim() });
      setUrl("");
    } catch (e) {
      setError(
        `Couldn't fetch that page (${e instanceof Error ? e.message : e}). Many sites, including Canvas, block this. Open it, select all, copy, and paste the text below instead.`,
      );
    }
    setBusy("");
  };

  const grouped = useMemo(() => {
    const q = filter.toLowerCase();
    const map = new Map<string, Reading[]>();
    for (const r of playOrder(readings)) {
      if (q && !`${r.title} ${r.course} ${r.author ?? ""}`.toLowerCase().includes(q)) continue;
      map.set(r.course, [...(map.get(r.course) ?? []), r]);
    }
    return [...map.entries()];
  }, [readings, filter]);

  const courses = useMemo(() => [...new Set(readings.map((r) => r.course))].sort(), [readings]);

  return (
    <section>
      <h1>Library</h1>
      <div className="card">
        <h2>Add readings</h2>
        <label>
          Course / block for new readings
          <input list="courses" value={course} onChange={(e) => rememberCourse(e.target.value)} placeholder="e.g. Airpower I, Leadership, Joint Warfare" />
          <datalist id="courses">{courses.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
        <div
          className="dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void onFiles(e.dataTransfer.files);
          }}
        >
          <p>Drop PDF, Word, HTML, or text files, or a whole offline course download (.zip / .epub), here</p>
          <input type="file" multiple accept={ACCEPTED_FILES} onChange={(e) => void onFiles(e.target.files)} />
        </div>
        <div className="row">
          <input className="grow" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="…or a public URL to an article or PDF" />
          <button disabled={!url.trim() || !!busy} onClick={() => void onUrl()}>Fetch</button>
        </div>
        <details>
          <summary>…or paste text</summary>
          <input value={pasteTitle} onChange={(e) => setPasteTitle(e.target.value)} placeholder="Title" />
          <textarea rows={6} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Paste the reading here" />
          <button
            className="primary"
            disabled={!pasteText.trim()}
            onClick={async () => {
              await add(pasteTitle, cleanText(pasteText));
              setPasteTitle("");
              setPasteText("");
            }}
          >
            Add pasted reading
          </button>
        </details>
        {busy && <p className="muted">{busy}</p>}
        {error && <p className="error">{error}</p>}
      </div>

      {readings.length > 0 && (
        <input className="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter readings" />
      )}

      {grouped.map(([c, list]) => {
        const left = list.filter((r) => !r.completed);
        const mins = listenMinutes(left.reduce((n, r) => n + remainingWords(r), 0), settings.rate);
        return (
          <div key={c} className="card">
            <h2>
              {c}{" "}
              <span className="muted small">
                {list.length - left.length}/{list.length} done · ~{formatDuration(mins)} left at {settings.rate}×
              </span>
            </h2>
            <ul className="list">
              {list.map((r) => (
                <li key={r.id}>
                  <div className="row">
                    <input
                      type="checkbox"
                      checked={r.completed}
                      title="Mark complete"
                      onChange={(e) => void saveReading({ ...r, completed: e.target.checked, position: 0 })}
                    />
                    <div className="grow">
                      <div className={r.completed ? "strong done" : "strong"}>
                        {nowPlaying?.id === r.id && "🔊 "}
                        {r.title}
                      </div>
                      <div className="muted small">
                        {r.author && `${r.author} · `}
                        {r.wordCount.toLocaleString()} words · {formatDuration(listenMinutes(r.wordCount, settings.rate))}
                        {r.brief && " · brief ready"}
                      </div>
                    </div>
                    <button
                      className="primary"
                      onClick={() => {
                        open(r, true);
                        go("listen");
                      }}
                    >
                      ▶
                    </button>
                    <button onClick={() => setEditing(editing === r.id ? null : r.id)}>Edit</button>
                    <button
                      className="danger"
                      onClick={() => {
                        if (confirm(`Delete “${r.title}”?`)) void deleteReading(r.id);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                  {editing === r.id && <ReadingEditor reading={r} onDone={() => setEditing(null)} />}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
