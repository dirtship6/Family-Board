export interface Reading {
  id: string;
  title: string;
  course: string;
  /** Lower numbers play first within a course. */
  order: number;
  text: string;
  wordCount: number;
  author?: string;
  publisher?: string;
  year?: string;
  url?: string;
  /** Sentence index where narration last stopped. */
  position: number;
  completed: boolean;
  createdAt: number;
  brief?: StudyBrief;
  notes?: string;
  /** Videos and outside articles this lesson page points to. */
  links?: ReadingLink[];
}

export interface ReadingLink {
  label: string;
  url: string;
  kind: "video" | "link";
}

export interface StudyBrief {
  bluf: string;
  thesis: string;
  keyArguments: string[];
  keyTerms: { term: string; definition: string }[];
  connections: string[];
  discussionQuestions: string[];
  likelyTested: string[];
}

/** A saved highlight in the degree-long notebook. */
export interface Note {
  id: string;
  createdAt: number;
  /** The saved text: a quote from a reading, or an AI answer. */
  quote: string;
  /** Your own thoughts on it. */
  comment: string;
  tags: string[];
  course: string;
  source: "reading" | "ai";
  readingId?: string;
  readingTitle?: string;
  /** First and last sentence of the quote in the reading, for jumping back and widening the quote. */
  sentenceStart?: number;
  sentenceEnd?: number;
  /** Chicago first-note citation captured when saved, so it survives the reading being deleted. */
  citation?: string;
}

export type TaskKind = "reading" | "quiz" | "paper" | "exam" | "discussion" | "other";

export interface Task {
  id: string;
  title: string;
  course: string;
  kind: TaskKind;
  due?: string; // yyyy-mm-dd
  done: boolean;
  notes?: string;
  createdAt: number;
}

export interface Paper {
  id: string;
  title: string;
  course: string;
  prompt: string;
  rubric: string;
  wordTarget: number;
  due?: string;
  thesis: string;
  outline: string;
  draft: string;
  sourceIds: string[];
  /** Latest AI coaching output, keyed by action. */
  coaching: Record<string, string>;
  updatedAt: number;
}

export interface Settings {
  apiKey: string;
  rate: number;
  voiceURI: string;
  autoContinue: boolean;
  followAlong: boolean;
  fontSize: number;
  /** yyyy-mm-dd you want to finish all readings by. */
  targetDate: string;
  theme: "terminal" | "daylight";
}

export const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  rate: 1.6,
  voiceURI: "",
  autoContinue: true,
  followAlong: true,
  fontSize: 18,
  targetDate: "",
  theme: "terminal",
};
