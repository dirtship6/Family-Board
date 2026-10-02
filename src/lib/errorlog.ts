// A small on-device log of recent problems, shown on the Help page and included in diagnostic reports.
export interface LoggedError {
  at: number;
  /** Where it happened: "Import", "AI", "Narration", "App"... */
  area: string;
  message: string;
}

const KEY = "acsc-speedrun.errors";
const MAX = 100;

export function readErrors(): LoggedError[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function logError(area: string, error: unknown): void {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  try {
    const list = [{ at: Date.now(), area, message }, ...readErrors()].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage full or unavailable; nothing more we can do.
  }
}

export function clearErrors(): void {
  localStorage.removeItem(KEY);
}

/** Catch anything that slips through so it shows up on the Help page. */
export function installGlobalErrorLogging(): void {
  window.addEventListener("error", (e) => logError("App", e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => logError("App", e.reason));
}
