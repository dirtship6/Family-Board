import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as db from "../lib/db";
import type { SkipKind } from "../lib/listening";
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
    const out: { p: number; skip?: SkipKind; items: { index: number; text: string; skip?: SkipKind }[] }[] = [];
    sentences.forEach((s, index) => {
      const last = out[out.length - 1];
      if (last?.p === s.p) last.items.push({ index, text: s.text, skip: s.skip });
      else out.push({ p: s.p, skip: s.skip, items: [{ index, text: s.text, skip: s.skip }] });
    });
    return out;
  }, [sentences]);

  // Lesson images live in their own store; turn them into object URLs while this reading is open.
  const [images, setImages] = useState<{ n: number; para: number; alt: string; url: string }[]>([]);
  const [zoomed, setZoomed] = useState<{ url: string; alt: string } | null>(null);
  useEffect(() => {
    let urls: string[] = [];
    let cancelled = false;
    setImages([]);
    if (nowPlaying?.imageCount) {
      void db.imagesFor(nowPlaying.id).then((list) => {
        if (cancelled) return;
        const mapped = list.map((img) => ({ n: img.n, para: img.para, alt: img.alt, url: URL.createObjectURL(img.data) }));
        urls = mapped.map((m) => m.url);
        setImages(mapped);
      });
    }
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [nowPlaying?.id, nowPlaying?.imageCount]);

  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const figure = (img: (typeof images)[number], nextText = "") => (
    <figure key={`img${img.n}`} className="lesson-figure">
      <button className="figure-btn" onClick={() => setZoomed(img)} aria-label={`Enlarge image: ${img.alt || "lesson image"}`}>
        <img src={img.url} alt={img.alt} loading="lazy" />
      </button>
      {/* Skip our caption when the lesson's own caption line follows the picture. */}
      {img.alt && !(nextText && norm(nextText).startsWith(norm(img.alt))) && <figcaption>{img.alt}</figcaption>}
    </figure>
  );

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
                      {r.course} · {formatDuration(listenMinutes(settings.listeningCleanup ? r.listenWords ?? r.wordCount : r.wordCount, settings.rate))} at {settings.rate}×
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

  const renderSentence = (index: number, text: string, skip?: SkipKind) => {
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
        className={`sentence${active ? " active" : index < sentenceIndex ? " read" : ""}${skip ? " skipped" : ""}`}
        title={skip ? "Not read aloud during continuous play; tap to hear it" : undefined}
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
      {nowPlaying.links?.length ? (
        <div className="page-links">
          <span className="muted small">On this page, outside the app:</span>
          {nowPlaying.links.map((l) => (
            <a key={l.url} className="page-link" href={l.url} target="_blank" rel="noreferrer">
              {l.kind === "video" ? "▶ " : "↗ "}
              {l.label.length > 60 ? `${l.label.slice(0, 58)}…` : l.label}
            </a>
          ))}
        </div>
      ) : null}
      {showText ? (
        <article ref={articleRef} className="reading-text" style={{ fontSize: settings.fontSize }}>
          {paragraphs.map(({ p, skip, items }, i) => (
            <Fragment key={p}>
              {images.filter((img) => img.para === p).map((img) => figure(img, items[0]?.text))}
              {skip && paragraphs[i - 1]?.skip !== skip && (
                <div className="skip-label">
                  {skip === "references" ? "References / notes" : "Table or figure text"} · skipped while listening
                </div>
              )}
              <p>{items.map((s) => renderSentence(s.index, s.text, s.skip))}</p>
            </Fragment>
          ))}
          {/* Pictures after the last paragraph. */}
          {images.filter((img) => img.para > (paragraphs[paragraphs.length - 1]?.p ?? -1)).map((img) => figure(img))}
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
      {zoomed && (
        <div className="lightbox" role="dialog" aria-label={zoomed.alt || "Image"} onClick={() => setZoomed(null)}>
          <img src={zoomed.url} alt={zoomed.alt} />
          {zoomed.alt && <div className="lightbox-caption">{zoomed.alt} · tap anywhere to close</div>}
        </div>
      )}
      {userScrolled && settings.followAlong && showText && (
        <button className="float-btn" onClick={() => setUserScrolled(false)}>
          Jump to current sentence
        </button>
      )}
    </section>
  );
}
