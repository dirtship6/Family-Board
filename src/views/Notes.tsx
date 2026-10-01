import { useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { notesToMarkdown, parseTags, widenNote } from "../lib/notes";
import { fold } from "../lib/search";
import { toSentences } from "../lib/text";
import type { Note } from "../lib/types";
import { Markdown } from "./Markdown";

function NoteCard({ note }: { note: Note }) {
  const { readings, saveNote, deleteNote, open, go, showToast } = useStore();
  const reading = note.readingId ? readings.find((r) => r.id === note.readingId) : undefined;
  const sentences = useMemo(() => (reading ? toSentences(reading.text) : []), [reading?.text]);
  const [comment, setComment] = useState(note.comment);
  const [tags, setTags] = useState(note.tags.join(", "));
  const timer = useRef<number | undefined>(undefined);

  // Edits to different fields are merged so a quick comment-then-tags edit keeps both.
  const pending = useRef<Partial<Note>>({});
  const saveSoon = (patch: Partial<Note>) => {
    pending.current = { ...pending.current, ...patch };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const change = pending.current;
      pending.current = {};
      void saveNote({ ...note, ...change });
    }, 500);
  };
  const widen = (edge: "start" | "end", delta: 1 | -1) => void saveNote(widenNote({ ...note, comment, tags: parseTags(tags) }, sentences, edge, delta));
  const canWiden = !!reading && note.sentenceStart !== undefined;

  return (
    <div className="card note">
      <div className="note-meta muted small">
        {note.course} · {note.readingTitle ?? "AI answer"} · {new Date(note.createdAt).toLocaleDateString()}
      </div>
      {canWiden && note.sentenceStart! > 0 && (
        <button className="link small" onClick={() => widen("start", 1)} title="Include the sentence before">
          ＋ earlier sentence
        </button>
      )}
      {note.source === "reading" ? <blockquote className="note-quote">{note.quote}</blockquote> : <Markdown text={note.quote} />}
      {canWiden && (
        <div className="row small">
          {note.sentenceEnd! < sentences.length - 1 && (
            <button className="link small" onClick={() => widen("end", 1)} title="Include the sentence after">＋ next sentence</button>
          )}
          {note.sentenceEnd! > note.sentenceStart! && (
            <>
              <button className="link small" onClick={() => widen("start", -1)}>− first</button>
              <button className="link small" onClick={() => widen("end", -1)}>− last</button>
            </>
          )}
        </div>
      )}
      {note.citation && <div className="muted small citation">{note.citation.replace(/\*/g, "")}</div>}
      <textarea
        rows={2}
        value={comment}
        placeholder="Your take: why it matters, where you'd use it…"
        onChange={(e) => {
          setComment(e.target.value);
          saveSoon({ comment: e.target.value });
        }}
      />
      <div className="row wrap">
        <input
          className="grow"
          value={tags}
          placeholder="tags, comma separated (e.g. cog, deterrence, paper2)"
          onChange={(e) => {
            setTags(e.target.value);
            saveSoon({ tags: parseTags(e.target.value) });
          }}
        />
        {reading && note.sentenceStart !== undefined && (
          <button
            onClick={() => {
              open(reading, false, note.sentenceStart);
              go("listen");
            }}
          >
            Go to source
          </button>
        )}
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(note.source === "reading" ? `“${note.quote}”\n${(note.citation ?? "").replace(/\*/g, "")}` : note.quote);
            showToast("Copied");
          }}
        >
          Copy
        </button>
        <button
          className="danger"
          onClick={() => {
            const backup = note;
            void deleteNote(note.id);
            showToast("Note deleted", { label: "Undo", run: () => void saveNote(backup) });
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export function Notes() {
  const { notes, readings } = useStore();
  const [q, setQ] = useState("");
  const [course, setCourse] = useState("");
  const [tag, setTag] = useState("");

  const courses = useMemo(() => [...new Set([...notes.map((n) => n.course), ...readings.map((r) => r.course)])].filter(Boolean).sort(), [notes, readings]);
  const allTags = useMemo(() => [...new Set(notes.flatMap((n) => n.tags))].sort(), [notes]);
  const shown = useMemo(() => {
    const terms = fold(q).split(/\s+/).filter(Boolean);
    return [...notes]
      .sort((a, b) => b.createdAt - a.createdAt)
      .filter((n) => (!course || n.course === course) && (!tag || n.tags.includes(tag)))
      .filter((n) => {
        if (!terms.length) return true;
        const hay = fold(`${n.quote} ${n.comment} ${n.readingTitle ?? ""} ${n.tags.join(" ")}`);
        return terms.every((t) => hay.includes(t));
      });
  }, [notes, q, course, tag]);

  const download = () => {
    const blob = new Blob([notesToMarkdown(shown)], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `acsc-notebook-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <section>
      <h1>Notes <span className="muted small">{notes.length} saved</span></h1>
      <p className="muted small">
        Your running notebook for the whole degree. Tap <strong>☆ Note</strong> in the player (or press <kbd>n</kbd>) to save the
        sentence being read, select text in a reading to save exactly that, or save from Search and Ask.
      </p>
      <div className="row wrap">
        <input className="grow" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your notes" />
        <select value={course} onChange={(e) => setCourse(e.target.value)} aria-label="Course">
          <option value="">All courses</option>
          {courses.map((c) => <option key={c}>{c}</option>)}
        </select>
        {allTags.length > 0 && (
          <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag">
            <option value="">All tags</option>
            {allTags.map((t) => <option key={t} value={t}>#{t}</option>)}
          </select>
        )}
        <button disabled={!shown.length} onClick={download} title="Markdown opens in Word, Google Docs, Obsidian, OneNote…">
          Export{shown.length !== notes.length ? ` ${shown.length}` : ""}
        </button>
      </div>
      {!notes.length && <p className="empty">No notes yet. Start listening and tap ☆ Note when something's worth keeping.</p>}
      {notes.length > 0 && !shown.length && <p className="empty">No notes match.</p>}
      {shown.map((n) => <NoteCard key={n.id} note={n} />)}
    </section>
  );
}
