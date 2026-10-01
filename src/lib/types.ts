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

export interface QuizQuestion {
  question: string;
  choices: string[];
  answerIndex: number;
  explanation: string;
  sourceTitle: string;
}

export interface QuizAttempt {
  id: string;
  createdAt: number;
  readingIds: string[];
  questions: QuizQuestion[];
  answers: (number | null)[];
  finished: boolean;
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
}

export const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  rate: 1.6,
  voiceURI: "",
  autoContinue: true,
  followAlong: true,
  fontSize: 18,
  targetDate: "",
};
