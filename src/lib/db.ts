import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Note, Paper, Reading, Task } from "./types";

interface StudyDB extends DBSchema {
  readings: { key: string; value: Reading };
  tasks: { key: string; value: Task };
  papers: { key: string; value: Paper };
  notes: { key: string; value: Note };
}

export type StoreName = "readings" | "tasks" | "papers" | "notes";
type ValueOf<S extends StoreName> = StudyDB[S]["value"];

let dbPromise: Promise<IDBPDatabase<StudyDB>> | null = null;

function db() {
  dbPromise ??= openDB<StudyDB>("acsc-speedrun", 2, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        d.createObjectStore("readings", { keyPath: "id" });
        d.createObjectStore("tasks", { keyPath: "id" });
        d.createObjectStore("papers", { keyPath: "id" });
      }
      if (oldVersion < 2) d.createObjectStore("notes", { keyPath: "id" });
    },
  });
  // Ask the browser not to evict this data under storage pressure: the notebook is meant to last the whole degree.
  void navigator.storage?.persist?.().catch(() => {});
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
  notes?: Note[];
}

export async function exportAll(): Promise<Backup> {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    readings: await all("readings"),
    tasks: await all("tasks"),
    papers: await all("papers"),
    notes: await all("notes"),
  };
}

export async function importAll(backup: Backup): Promise<void> {
  const d = await db();
  const tx = d.transaction(["readings", "tasks", "papers", "notes"], "readwrite");
  for (const r of backup.readings ?? []) tx.objectStore("readings").put(r);
  for (const t of backup.tasks ?? []) tx.objectStore("tasks").put(t);
  for (const p of backup.papers ?? []) tx.objectStore("papers").put(p);
  for (const n of backup.notes ?? []) tx.objectStore("notes").put(n);
  await tx.done;
}
