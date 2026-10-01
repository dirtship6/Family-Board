import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { playOrder, useStore } from "../store";
import { formatDuration, listenMinutes } from "../lib/text";

export function Listen() {
  const { nowPlaying, sentences, sentenceIndex, word, narrator, settings, updateSettings, readings, open, go, captureNote } = useStore();
  const articleRef = useRef<HTMLElement>(null);
  const [selection, setSelection] = useState<{ start: number; end: number; quote: string; x: number; y: number } | null>(null);

  // Selecting text in the reading offers a "Save to notes" button for exactly that text.
  useEffect(() => {
    let t: number | undefined;
    const onChange = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        const sel = window.getSelection();
        const article = articleRef.current;
        if (!sel || sel.isCollapsed || !article || !sel.rangeCount) return setSelection(null);
        const range = sel.getRangeAt(0);
        if (!article.contains(range.commonAncestorContainer)) return setSelection(null);
        const idx = (n: Node | null) => {
          const el = n instanceof Element ? n : n?.parentElement;
          const i = el?.closest<HTMLElement>("[data-i]")?.dataset.i;
          return i === undefined ? null : Number(i);
        };
        const a = idx(range.startContainer);
        const b = idx(range.endContainer);
        const quote = sel.toString().replace(/\s+/g, " ").trim();
        if (a === null || b === null || !quote) return setSelection(null);
        const rect = range.getBoundingClientRect();
        setSelection({
          start: Math.min(a, b),
          end: Math.max(a, b),
          quote,
          x: rect.left + rect.width / 2 + window.scrollX,
          y: rect.top + window.scrollY,
        });
      }, 250);
    };
    document.addEventListener("selectionchange", onChange);
    return () => {
      document.removeEventListener("selectionchange", onChange);
      window.clearTimeout(t);
    };
  }, []);
  const [showText, setShowText] = useState(true);
  const activeRef = useRef<HTMLSpanElement>(null);
  const [userScrolled, setUserScrolled] = useState(false);

  // Follow along: keep the spoken sentence in view, unless you've scrolled away to skim.
  useEffect(() => {
    if (!settings.followAlong || userScrolled || !showText) return;
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [sentenceIndex, settings.followAlong, userScrolled, showText]);

  useEffect(() => {
    let t: number | undefined;
    const onWheel = () => {
      setUserScrolled(true);
      window.clearTimeout(t);
      t = window.setTimeout(() => setUserScrolled(false), 8000);
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchmove", onWheel, { passive: true });
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchmove", onWheel);
      window.clearTimeout(t);
    };
  }, []);

  const paragraphs = useMemo(() => {
    const out: { index: number; text: string }[][] = [];
    sentences.forEach((s, index) => {
      (out[s.p] ??= []).push({ index, text: s.text });
    });
    return out.filter(Boolean);
  }, [sentences]);

  const queue = useMemo(() => playOrder(readings).filter((r) => !r.completed), [readings]);

  if (!nowPlaying) {
    return (
      <section>
        <h1>Listen</h1>
        {queue.length ? (
          <>
            <p className="muted">Pick up where you left off. Readings play in course order and auto-continue to the next one.</p>
            <ul className="list">
              {queue.slice(0, 12).map((r) => (
                <li key={r.id} className="row">
                  <div className="grow">
                    <div className="strong">{r.title}</div>
                    <div className="muted small">
                      {r.course} · {formatDuration(listenMinutes(r.wordCount, settings.rate))} at {settings.rate}×
                      {r.position > 0 && " · in progress"}
                    </div>
                  </div>
                  <button className="primary" onClick={() => open(r, true)}>▶ Play</button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="empty">
            Nothing queued. <button className="link" onClick={() => go("library")}>Add readings to your library</button>.
          </p>
        )}
      </section>
    );
  }

  const renderSentence = (index: number, text: string) => {
    const active = index === sentenceIndex;
    let body: ReactNode = text;
    if (active && word && word.s === index && word.len > 0) {
      body = (
        <>
          {text.slice(0, word.start)}
          <mark className="word">{text.slice(word.start, word.start + word.len)}</mark>
          {text.slice(word.start + word.len)}
        </>
      );
    }
    return (
      <span
        key={index}
        ref={active ? activeRef : undefined}
        data-i={index}
        className={active ? "sentence active" : index < sentenceIndex ? "sentence read" : "sentence"}
        onClick={() => {
          // Don't jump the narration when the click finished a text selection.
          if (!window.getSelection()?.isCollapsed) return;
          narrator.seek(index);
        }}
      >
        {body}{" "}
      </span>
    );
  };

  return (
    <section className="reader">
      <div className="reader-head">
        <div>
          <h1>{nowPlaying.title}</h1>
          <div className="muted small">
            {nowPlaying.course}
            {nowPlaying.author && ` · ${nowPlaying.author}`} · sentence {sentenceIndex + 1} of {sentences.length}
          </div>
        </div>
        <div className="reader-tools">
          <label className="toggle">
            <input type="checkbox" checked={showText} onChange={(e) => setShowText(e.target.checked)} /> Show text
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.followAlong}
              onChange={(e) => updateSettings({ followAlong: e.target.checked })}
            />{" "}
            Auto-scroll
          </label>
          <label className="toggle">
            A
            <input
              type="range"
              min={14}
              max={28}
              value={settings.fontSize}
              onChange={(e) => updateSettings({ fontSize: Number(e.target.value) })}
              aria-label="Text size"
            />
          </label>
          <button onClick={() => go("study")}>Brief &amp; Q&amp;A →</button>
        </div>
      </div>
      {showText ? (
        <article ref={articleRef} className="reading-text" style={{ fontSize: settings.fontSize }}>
          {paragraphs.map((p, i) => (
            <p key={i}>{p.map((s) => renderSentence(s.index, s.text))}</p>
          ))}
        </article>
      ) : (
        <div className="audio-only">
          <p className="muted">Listening mode. The current sentence:</p>
          <p className="now-sentence">{sentences[sentenceIndex]?.text}</p>
        </div>
      )}
      {selection && showText && (
        <button
          className="primary selection-save"
          style={{ left: selection.x, top: selection.y }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            void captureNote(selection);
            window.getSelection()?.removeAllRanges();
            setSelection(null);
          }}
        >
          ☆ Save to notes
        </button>
      )}
      {userScrolled && settings.followAlong && showText && (
        <button className="float-btn" onClick={() => setUserScrolled(false)}>
          Jump to current sentence
        </button>
      )}
    </section>
  );
}
