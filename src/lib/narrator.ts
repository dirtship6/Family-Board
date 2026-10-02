// Sentence-by-sentence narration on top of the Web Speech API.
// Speaking one sentence per utterance keeps highlighting exact, makes
// seeking instant, and sidesteps Chrome's habit of silently stopping
// long utterances after ~15 seconds.
import { logError } from "./errorlog";
import type { SpokenSentence } from "./listening";

export interface NarratorEvents {
  onSentence(index: number): void;
  onWord?(sentenceIndex: number, charIndex: number, charLength: number): void;
  onStateChange(playing: boolean): void;
  onFinished(): void;
}

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!speechSupported()) return Promise.resolve([]);
  const synth = window.speechSynthesis;
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => resolve(synth.getVoices());
    synth.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, 1500);
  });
}

/** English voices first, "natural"/"neural"/"premium" voices at the top. */
export function rankVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  const score = (v: SpeechSynthesisVoice) =>
    (v.lang.startsWith("en") ? 100 : 0) +
    (/natural|neural|premium|enhanced|online/i.test(v.name) ? 50 : 0) +
    (v.lang === "en-US" ? 10 : 0) +
    (v.localService ? 0 : 5);
  return [...voices].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
}

export class Narrator {
  private sentences: SpokenSentence[] = [];
  private index = 0;
  private playing = false;
  /** Bumped on every (re)start so callbacks from cancelled utterances are ignored. */
  private generation = 0;
  private keepAlive: number | undefined;
  rate = 1.5;
  voice: SpeechSynthesisVoice | null = null;

  constructor(private events: NarratorEvents) {}

  load(sentences: SpokenSentence[], startAt = 0) {
    this.stop();
    this.sentences = sentences;
    this.index = Math.min(Math.max(startAt, 0), Math.max(sentences.length - 1, 0));
    this.events.onSentence(this.index);
  }

  get current() {
    return this.index;
  }

  get isPlaying() {
    return this.playing;
  }

  play() {
    if (!speechSupported() || !this.sentences.length) return;
    this.playing = true;
    this.events.onStateChange(true);
    this.startKeepAlive();
    this.speakCurrent();
  }

  pause() {
    this.playing = false;
    this.generation++;
    window.speechSynthesis.cancel();
    this.stopKeepAlive();
    this.events.onStateChange(false);
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  stop() {
    if (speechSupported()) {
      this.generation++;
      window.speechSynthesis.cancel();
    }
    this.stopKeepAlive();
    if (this.playing) {
      this.playing = false;
      this.events.onStateChange(false);
    }
  }

  seek(index: number) {
    this.index = Math.min(Math.max(index, 0), this.sentences.length - 1);
    this.events.onSentence(this.index);
    if (this.playing) this.speakCurrent();
  }

  skip(delta: number) {
    this.seek(this.index + delta);
  }

  /** Jump to the first sentence of the next/previous paragraph. */
  skipParagraph(delta: 1 | -1) {
    const p = this.sentences[this.index]?.p ?? 0;
    const target = delta > 0 ? p + 1 : this.index > 0 && this.sentences[this.index - 1].p === p ? p : p - 1;
    const i = this.sentences.findIndex((s) => s.p === target);
    if (i >= 0) this.seek(i);
    else if (delta > 0) this.seek(this.sentences.length - 1);
  }

  setRate(rate: number) {
    this.rate = rate;
    if (this.playing) this.speakCurrent();
  }

  setVoice(voice: SpeechSynthesisVoice | null) {
    this.voice = voice;
    if (this.playing) this.speakCurrent();
  }

  private speakCurrent() {
    const synth = window.speechSynthesis;
    const gen = ++this.generation;
    synth.cancel();
    const sentence = this.sentences[this.index];
    if (!sentence) return;
    const u = new SpeechSynthesisUtterance(sentence.speak);
    // Word highlighting indexes into what is spoken; only valid when nothing was removed.
    const exact = sentence.speak === sentence.text;
    u.rate = this.rate;
    if (this.voice) {
      u.voice = this.voice;
      u.lang = this.voice.lang;
    }
    const at = this.index;
    u.onboundary = (e) => {
      if (gen === this.generation && e.name === "word" && exact) {
        this.events.onWord?.(at, e.charIndex, e.charLength ?? 0);
      }
    };
    u.onend = () => {
      if (gen !== this.generation || !this.playing) return;
      // Continuous play passes over reference lists and tables; tapping one still reads it.
      let next = this.index + 1;
      while (next < this.sentences.length && this.sentences[next].skip) next++;
      if (next >= this.sentences.length) {
        this.playing = false;
        this.stopKeepAlive();
        this.events.onStateChange(false);
        this.events.onFinished();
        return;
      }
      this.index = next;
      this.events.onSentence(this.index);
      this.speakCurrent();
    };
    u.onerror = (e) => {
      if (gen !== this.generation) return;
      if (e.error === "interrupted" || e.error === "canceled") return;
      logError("Narration", `Speech engine error: ${e.error}`);
      this.pause();
    };
    synth.speak(u);
  }

  // Some Chromium builds pause the synth when the tab is backgrounded for a while;
  // a periodic resume() keeps narration going while you work in another tab.
  private startKeepAlive() {
    this.stopKeepAlive();
    this.keepAlive = window.setInterval(() => {
      if (this.playing && window.speechSynthesis.paused) window.speechSynthesis.resume();
    }, 5000);
  }

  private stopKeepAlive() {
    if (this.keepAlive !== undefined) window.clearInterval(this.keepAlive);
    this.keepAlive = undefined;
  }
}
