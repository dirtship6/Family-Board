import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Note, Paper, Reading, ReadingImage, Task } from "./types";

interface StudyDB extends DBSchema {
  readings: { key: string; value: Reading };
  tasks: { key: string; value: Task };
  papers: { key: string; value: Paper };
  notes: { key: string; value: Note };
  images: { key: string; value: ReadingImage };
}

export type StoreName = "readings" | "tasks" | "papers" | "notes";
type ValueOf<S extends StoreName> = StudyDB[S]["value"];

let dbPromise: Promise<IDBPDatabase<StudyDB>> | null = null;

function db() {
  dbPromise ??= openDB<StudyDB>("acsc-speedrun", 3, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        d.createObjectStore("readings", { keyPath: "id" });
        d.createObjectStore("tasks", { keyPath: "id" });
        d.createObjectStore("papers", { keyPath: "id" });
      }
      if (oldVersion < 2) d.createObjectStore("notes", { keyPath: "id" });
      if (oldVersion < 3) d.createObjectStore("images", { keyPath: "id" });
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

const imageRange = (readingId: string) => IDBKeyRange.bound(`${readingId}:`, `${readingId}:\uffff`);

export async function imagesFor(readingId: string): Promise<ReadingImage[]> {
  const list = await (await db()).getAll("images", imageRange(readingId));
  return list.sort((a, b) => a.n - b.n);
}

export async function putImages(images: ReadingImage[]): Promise<void> {
  const tx = (await db()).transaction("images", "readwrite");
  for (const img of images) tx.store.put(img);
  await tx.done;
}

export async function deleteImages(readingId: string): Promise<void> {
  await (await db()).delete("images", imageRange(readingId));
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
  /** Images as data URLs (Blobs don't survive JSON). */
  images?: (Omit<ReadingImage, "data"> & { dataUrl: string })[];
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function exportAll(): Promise<Backup> {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    readings: await all("readings"),
    tasks: await all("tasks"),
    papers: await all("papers"),
    notes: await all("notes"),
    images: await Promise.all(
      (await (await db()).getAll("images")).map(async ({ data, ...rest }) => ({ ...rest, dataUrl: await blobToDataUrl(data) })),
    ),
  };
}

export async function importAll(backup: Backup): Promise<void> {
  const d = await db();
  // Decode images before the transaction: awaiting fetch() inside it would let it auto-commit.
  const images = await Promise.all(
    (backup.images ?? []).map(async ({ dataUrl, ...rest }) => ({ ...rest, data: await (await fetch(dataUrl)).blob() })),
  );
  const tx = d.transaction(["readings", "tasks", "papers", "notes", "images"], "readwrite");
  for (const r of backup.readings ?? []) tx.objectStore("readings").put(r);
  for (const t of backup.tasks ?? []) tx.objectStore("tasks").put(t);
  for (const p of backup.papers ?? []) tx.objectStore("papers").put(p);
  for (const n of backup.notes ?? []) tx.objectStore("notes").put(n);
  for (const img of images) tx.objectStore("images").put(img);
  await tx.done;
}
