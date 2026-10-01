import { useEffect } from "react";
import { StoreProvider, useStore, type View } from "./store";
import { PlayerBar } from "./views/PlayerBar";
import { Today } from "./views/Today";
import { Library } from "./views/Library";
import { Listen } from "./views/Listen";
import { Search } from "./views/Search";
import { Notes } from "./views/Notes";
import { Study } from "./views/Study";
import { Papers } from "./views/Papers";
import { Tasks } from "./views/Tasks";
import { SettingsView } from "./views/Settings";

const TABS: { id: View; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "library", label: "Library" },
  { id: "listen", label: "Listen" },
  { id: "search", label: "Search" },
  { id: "notes", label: "Notes" },
  { id: "study", label: "Study" },
  { id: "papers", label: "Papers" },
  { id: "tasks", label: "Tasks" },
  { id: "settings", label: "Settings" },
];

function Shell() {
  const { view, go, narrator, nowPlaying, captureNote, toast } = useStore();

  // Global keyboard shortcuts for the player (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]") || !nowPlaying) return;
      if (e.key === " " || e.key === "k") narrator.toggle();
      else if (e.key === "ArrowRight" || e.key === "l") narrator.skip(1);
      else if (e.key === "ArrowLeft" || e.key === "j") narrator.skip(-1);
      else if (e.key === "ArrowDown") narrator.skipParagraph(1);
      else if (e.key === "ArrowUp") narrator.skipParagraph(-1);
      else if (e.key === "n") void captureNote();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [narrator, nowPlaying, captureNote]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">ACSC Speedrun</div>
        <nav className="tabs" aria-label="Sections">
          {TABS.map((t) => (
            <button key={t.id} className={view === t.id ? "tab active" : "tab"} onClick={() => go(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main className="content">
        {view === "today" && <Today />}
        {view === "library" && <Library />}
        {view === "listen" && <Listen />}
        {view === "search" && <Search />}
        {view === "notes" && <Notes />}
        {view === "study" && <Study />}
        {view === "papers" && <Papers />}
        {view === "tasks" && <Tasks />}
        {view === "settings" && <SettingsView />}
      </main>
      <PlayerBar />
      {toast && (
        <div className="toast" role="status">
          {toast.text}
          {toast.action && (
            <button className="link" onClick={toast.action.run}>
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
