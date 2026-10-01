import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as db from "./lib/db";
import { Narrator, loadVoices, rankVoices } from "./lib/narrator";
import { toSentences, type Sentence } from "./lib/text";
import { DEFAULT_SETTINGS, type Reading, type Settings } from "./lib/types";

const SETTINGS_KEY = "acsc-speedrun.settings";

function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export type View = "today" | "library" | "listen" | "study" | "papers" | "tasks" | "settings";

/** Readings in play order: by course, then the course's order field. */
export function playOrder(readings: Reading[]): Reading[] {
  return [...readings].sort(
    (a, b) => a.course.localeCompare(b.course) || a.order - b.order || a.createdAt - b.createdAt,
  );
}

interface Store {
  view: View;
  go(view: View): void;
  settings: Settings;
  updateSettings(patch: Partial<Settings>): void;
  readings: Reading[];
  saveReading(r: Reading): Promise<void>;
  deleteReading(id: string): Promise<void>;
  reloadReadings(): Promise<void>;
  voices: SpeechSynthesisVoice[];
  // Player
  nowPlaying: Reading | null;
  sentences: Sentence[];
  sentenceIndex: number;
  word: { s: number; start: number; len: number } | null;
  playing: boolean;
  open(reading: Reading, play?: boolean): void;
  narrator: Narrator;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside provider");
  return s;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<View>("today");
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [nowPlaying, setNowPlaying] = useState<Reading | null>(null);
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [sentenceIndex, setSentenceIndex] = useState(0);
  const [word, setWord] = useState<Store["word"]>(null);
  const [playing, setPlaying] = useState(false);

  const readingsRef = useRef(readings);
  readingsRef.current = readings;
  const nowPlayingRef = useRef(nowPlaying);
  nowPlayingRef.current = nowPlaying;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const openRef = useRef<(r: Reading, play?: boolean) => void>(() => {});

  const saveReading = useCallback(async (input: Reading) => {
    // The narrator owns the live listening position; never let a stale copy rewind it.
    const live = nowPlayingRef.current;
    const r = live?.id === input.id ? { ...input, position: live.position, completed: live.completed || input.completed } : input;
    if (live?.id === r.id) nowPlayingRef.current = r;
    await db.put("readings", r);
    setReadings((prev) => {
      const i = prev.findIndex((x) => x.id === r.id);
      if (i < 0) return [...prev, r];
      const next = prev.slice();
      next[i] = r;
      return next;
    });
    if (nowPlayingRef.current?.id === r.id) setNowPlaying(r);
  }, []);

  // Persist the listening position (debounced via sentence changes) so you can resume anywhere.
  const persistPosition = useRef<number | undefined>(undefined);
  const savePosition = useCallback(
    (index: number, completed?: boolean) => {
      const r = nowPlayingRef.current;
      if (!r) return;
      window.clearTimeout(persistPosition.current);
      const updated = { ...r, position: index, completed: completed ?? r.completed };
      nowPlayingRef.current = updated;
      if (completed) void saveReading(updated);
      else
        persistPosition.current = window.setTimeout(() => {
          const cur = nowPlayingRef.current;
          void saveReading(cur?.id === updated.id ? cur : updated);
        }, 1500);
    },
    [saveReading],
  );

  const narrator = useMemo(
    () =>
      new Narrator({
        onSentence(i) {
          setSentenceIndex(i);
          setWord(null);
          savePosition(i);
        },
        onWord(s, start, len) {
          setWord({ s, start, len });
        },
        onStateChange: setPlaying,
        onFinished() {
          const cur = nowPlayingRef.current;
          if (!cur) return;
          savePosition(0, true);
          if (!settingsRef.current.autoContinue) return;
          const order = playOrder(readingsRef.current);
          const idx = order.findIndex((r) => r.id === cur.id);
          const next = order.slice(idx + 1).find((r) => !r.completed && r.id !== cur.id);
          if (next) openRef.current(next, true);
        },
      }),
    [savePosition],
  );

  const open = useCallback(
    (reading: Reading, play = false) => {
      const s = toSentences(reading.text);
      setNowPlaying(reading);
      nowPlayingRef.current = reading;
      setSentences(s);
      narrator.load(s, reading.completed ? 0 : reading.position);
      if (play) narrator.play();
    },
    [narrator],
  );
  openRef.current = open;

  const reloadReadings = useCallback(async () => {
    setReadings(await db.all("readings"));
  }, []);

  useEffect(() => {
    void reloadReadings();
    void loadVoices().then((v) => setVoices(rankVoices(v)));
  }, [reloadReadings]);

  useEffect(() => {
    narrator.rate = settings.rate;
  }, [narrator, settings.rate]);

  useEffect(() => {
    const v = voices.find((x) => x.voiceURI === settings.voiceURI) ?? voices[0] ?? null;
    narrator.voice = v;
  }, [narrator, voices, settings.voiceURI]);

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
        return next;
      });
      if (patch.rate !== undefined) narrator.setRate(patch.rate);
      if (patch.voiceURI !== undefined) {
        narrator.setVoice(voices.find((x) => x.voiceURI === patch.voiceURI) ?? null);
      }
    },
    [narrator, voices],
  );

  const deleteReading = useCallback(
    async (id: string) => {
      await db.remove("readings", id);
      setReadings((prev) => prev.filter((r) => r.id !== id));
      if (nowPlayingRef.current?.id === id) {
        narrator.stop();
        setNowPlaying(null);
        setSentences([]);
      }
    },
    [narrator],
  );

  const value: Store = {
    view,
    go: setView,
    settings,
    updateSettings,
    readings,
    saveReading,
    deleteReading,
    reloadReadings,
    voices,
    nowPlaying,
    sentences,
    sentenceIndex,
    word,
    playing,
    open,
    narrator,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
