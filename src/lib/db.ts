import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Paper, QuizAttempt, Reading, Task } from "./types";

interface StudyDB extends DBSchema {
  readings: { key: string; value: Reading };
  tasks: { key: string; value: Task };
  papers: { key: string; value: Paper };
  quizzes: { key: string; value: QuizAttempt };
}

export type StoreName = "readings" | "tasks" | "papers" | "quizzes";
type ValueOf<S extends StoreName> = StudyDB[S]["value"];

let dbPromise: Promise<IDBPDatabase<StudyDB>> | null = null;

function db() {
  dbPromise ??= openDB<StudyDB>("acsc-speedrun", 1, {
    upgrade(d) {
      d.createObjectStore("readings", { keyPath: "id" });
      d.createObjectStore("tasks", { keyPath: "id" });
      d.createObjectStore("papers", { keyPath: "id" });
      d.createObjectStore("quizzes", { keyPath: "id" });
    },
  });
  return dbPromise;
}

export async function all<S extends StoreName>(store: S): Promise<ValueOf<S>[]> {
  return (await db()).getAll(store) as Promise<ValueOf<S>[]>;
}

export async function put<S extends StoreName>(store: S, value: ValueOf<S>): Promise<void> {
  await (await db()).put(store, value as never);
}

export async function remove(store: StoreName, id: string): Promise<void> {
  await (await db()).delete(store, id);
}

export function newId(): string {
  return crypto.randomUUID();
}

export interface Backup {
  version: 1;
  exportedAt: string;
  readings: Reading[];
  tasks: Task[];
  papers: Paper[];
  quizzes: QuizAttempt[];
}

export async function exportAll(): Promise<Backup> {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    readings: await all("readings"),
    tasks: await all("tasks"),
    papers: await all("papers"),
    quizzes: await all("quizzes"),
  };
}

export async function importAll(backup: Backup): Promise<void> {
  const d = await db();
  const tx = d.transaction(["readings", "tasks", "papers", "quizzes"], "readwrite");
  for (const r of backup.readings ?? []) tx.objectStore("readings").put(r);
  for (const t of backup.tasks ?? []) tx.objectStore("tasks").put(t);
  for (const p of backup.papers ?? []) tx.objectStore("papers").put(p);
  for (const q of backup.quizzes ?? []) tx.objectStore("quizzes").put(q);
  await tx.done;
}
