import { useStore } from "../store";
import { formatDuration, listenMinutes, wordCount } from "../lib/text";

export const RATES = [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3];

export function PlayerBar() {
  const { nowPlaying, sentences, sentenceIndex, playing, narrator, settings, updateSettings, go, view, captureNote } = useStore();
  if (!nowPlaying) return null;
  const pct = sentences.length ? ((sentenceIndex + 1) / sentences.length) * 100 : 0;
  const remainingWords = sentences.slice(sentenceIndex).reduce((n, s) => n + wordCount(s.text), 0);

  return (
    <div className="player" role="region" aria-label="Narration player">
      <div className="player-progress" style={{ width: `${pct}%` }} />
      <button className="player-title" onClick={() => go("listen")} title="Open follow-along text">
        <span className="t">{nowPlaying.title}</span>
        <span className="sub">
          {nowPlaying.course} · {Math.round(pct)}% · {formatDuration(listenMinutes(remainingWords, settings.rate))} left
          {view !== "listen" && " · tap to follow along"}
        </span>
      </button>
      <div className="player-controls">
        <button onClick={() => narrator.skipParagraph(-1)} aria-label="Previous paragraph" title="Previous paragraph (↑)">⏮</button>
        <button onClick={() => narrator.skip(-1)} aria-label="Previous sentence" title="Previous sentence (←)">↶</button>
        <button className="play" onClick={() => narrator.toggle()} aria-label={playing ? "Pause" : "Play"} title="Play/pause (space)">
          {playing ? "❚❚" : "▶"}
        </button>
        <button onClick={() => narrator.skip(1)} aria-label="Next sentence" title="Next sentence (→)">↷</button>
        <button onClick={() => narrator.skipParagraph(1)} aria-label="Next paragraph" title="Next paragraph (↓)">⏭</button>
        <button className="note-btn" onClick={() => void captureNote()} aria-label="Save this sentence to notes" title="Save the sentence being read to your notes (n)">
          ☆<span className="label"> Note</span>
        </button>
        <select
          value={settings.rate}
          onChange={(e) => updateSettings({ rate: Number(e.target.value) })}
          aria-label="Speed"
        >
          {[...new Set([...RATES, settings.rate])].sort((a, b) => a - b).map((r) => (
            <option key={r} value={r}>{r}×</option>
          ))}
        </select>
      </div>
    </div>
  );
}
