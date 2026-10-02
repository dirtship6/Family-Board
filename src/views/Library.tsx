import { useMemo, useState } from "react";
import { playOrder, useStore } from "../store";
import { ACCEPTED_FILES, importAny, importUrl, type ImportedDoc } from "../lib/importers";
import * as db from "../lib/db";
import { newId } from "../lib/db";
import { cleanText, formatDuration, listenMinutes, remainingWords, wordCount } from "../lib/text";
import { listenWordCount, repairLigatures } from "../lib/listening";
import { logError } from "../lib/errorlog";
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
            await saveReading({ ...r, text, wordCount: wordCount(text), listenWords: listenWordCount(text), position: changed ? 0 : r.position });
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

interface ImportSummary {
  courses: string[];
  readings: number;
  pages: number;
  skipped: number;
  tasks: number;
  papers: number;
  repaired: number;
  repairedDocs: number;
  notices: string[];
}

export function Library() {
  const { readings, saveReading, deleteReading, open, go, settings, nowPlaying } = useStore();
  const [course, setCourse] = useState(() => localStorage.getItem("acsc-speedrun.lastCourse") ?? "");
  const [busy, setBusy] = useState("");
  const [summary, setSummary] = useState<ImportSummary | null>(null);
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

  const add = async (title: string, text: string, extra: Partial<Reading> = {}, images?: ImportedDoc["images"]) => {
    const c = course.trim() || "Unsorted";
    const id = newId();
    // Store pictures first so the reading never points at images that aren't there yet.
    if (images?.length) {
      await db.putImages(images.map((img, n) => ({ id: `${id}:${String(n).padStart(3, "0")}`, readingId: id, n, para: img.para, alt: img.alt, data: img.data })));
    }
    const reading: Reading = {
      id,
      title: title.trim() || "Untitled reading",
      course: c,
      order: nextOrder(c),
      text,
      wordCount: wordCount(text),
      listenWords: listenWordCount(text),
      position: 0,
      completed: false,
      createdAt: Date.now(),
      imageCount: images?.length || undefined,
      ...extra,
    };
    await saveReading(reading);
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError("");
    setSummary(null);
    const problems: string[] = [];
    const sum: ImportSummary = { courses: [], readings: 0, pages: 0, skipped: 0, tasks: 0, papers: 0, repaired: 0, repairedDocs: 0, notices: [] };
    // `readings` won't refresh mid-loop, so track what exists and the play order locally.
    const have = new Set(readings.map((r) => `${r.course}\u0000${r.title}`.toLowerCase()));
    const orders = new Map<string, number>();
    const orderFor = (c: string) => {
      const n = orders.get(c) ?? nextOrder(c);
      orders.set(c, n + 1);
      return n;
    };
    const existingTasks = new Set((await db.all("tasks")).map((t) => `${t.course}\u0000${t.title}`.toLowerCase()));
    const existingPapers = new Set((await db.all("papers")).map((p) => `${p.course}\u0000${p.title}`.toLowerCase()));

    for (const f of Array.from(files)) {
      setBusy(`Importing ${f.name}…`);
      try {
        const result = await importAny(f, (m) => setBusy(`${f.name}: ${m}`));
        const docs = result.docs.filter((d) => d.text.trim());
        // Repair words some PDFs lose to dropped ligatures ("Te" → "The"), using everything else as a dictionary.
        for (const doc of docs) {
          const others = [...docs.filter((d) => d !== doc).map((d) => d.text), ...readings.map((r) => r.text)];
          const repaired = repairLigatures(doc.text, others);
          if (repaired.fixes) {
            doc.text = repaired.text;
            sum.repaired += repaired.fixes;
            sum.repairedDocs++;
          }
        }
        if (!docs.length && !result.tasks?.length) throw new Error("no text found (scanned PDFs need OCR first)");
        // A course package names its own course; loose files go to the course typed above.
        const c = result.course || course.trim() || "Unsorted";
        if (result.course && !sum.courses.includes(c)) sum.courses.push(c);
        for (const doc of docs) {
          const key = `${c}\u0000${doc.title}`.toLowerCase();
          if (have.has(key)) {
            sum.skipped++;
            continue;
          }
          have.add(key);
          await add(doc.title, doc.text, { course: c, order: orderFor(c), author: doc.author, year: doc.year, links: doc.links }, doc.images);
          sum[doc.kind === "page" ? "pages" : "readings"]++;
        }
        for (const t of result.tasks ?? []) {
          const key = `${c}\u0000${t.title}`.toLowerCase();
          if (existingTasks.has(key)) continue;
          existingTasks.add(key);
          await db.put("tasks", { id: db.newId(), title: t.title, course: c, kind: t.kind, done: false, createdAt: Date.now() + sum.tasks });
          sum.tasks++;
        }
        for (const p of result.papers ?? []) {
          const key = `${c}\u0000${p.title}`.toLowerCase();
          if (existingPapers.has(key)) continue;
          existingPapers.add(key);
          await db.put("papers", {
            id: db.newId(), title: p.title, course: c, prompt: p.prompt, rubric: "", wordTarget: p.wordTarget ?? 0,
            thesis: "", outline: "", draft: "", sourceIds: [], coaching: {}, updatedAt: Date.now(),
          });
          sum.papers++;
        }
        sum.notices.push(...(result.notices ?? []));
      } catch (e) {
        problems.push(`${f.name}: ${e instanceof Error ? e.message : e}`);
        logError("Import", `${f.name}: ${e instanceof Error ? e.message : e}`);
      }
    }
    setBusy("");
    setSummary(sum);
    if (sum.courses.length === 1) rememberCourse(sum.courses[0]);
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
          <input
            type="file"
            multiple
            accept={ACCEPTED_FILES}
            onChange={(e) => {
              const input = e.target;
              // Clear afterwards so choosing the same file again (e.g. a re-downloaded course) still imports.
              void onFiles(input.files).finally(() => (input.value = ""));
            }}
          />
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
        {summary && (
          <div className="notice import-summary">
            <strong>
              Imported{summary.courses.length ? ` ${summary.courses.join(", ")}` : ""}:
            </strong>{" "}
            {[
              summary.pages && `${summary.pages} lesson page${summary.pages === 1 ? "" : "s"}`,
              summary.readings && `${summary.readings} reading${summary.readings === 1 ? "" : "s"}`,
              summary.tasks && `${summary.tasks} task${summary.tasks === 1 ? "" : "s"}`,
              summary.papers && `${summary.papers} assignment${summary.papers === 1 ? "" : "s"} set up in Papers`,
              summary.skipped && `${summary.skipped} already in your library (skipped)`,
              summary.repaired &&
                `repaired ${summary.repaired} damaged word${summary.repaired === 1 ? "" : "s"} in ${summary.repairedDocs} PDF${summary.repairedDocs === 1 ? "" : "s"}`,
            ]
              .filter(Boolean)
              .join(" · ") || "nothing new"}
            .
            {summary.notices.map((n, i) => (
              <p key={i} className="small">⚠ {n}</p>
            ))}
          </div>
        )}
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
                        {r.wordCount.toLocaleString()} words · {formatDuration(listenMinutes(settings.listeningCleanup ? r.listenWords ?? r.wordCount : r.wordCount, settings.rate))}
                        {r.imageCount ? ` · ${r.imageCount} image${r.imageCount === 1 ? "" : "s"}` : ""}
                        {r.links?.length ? ` · ${r.links.length} video/link${r.links.length === 1 ? "" : "s"}` : ""}
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
