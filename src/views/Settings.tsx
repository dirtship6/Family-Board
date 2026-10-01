import { useState } from "react";
import { useStore } from "../store";
import { exportAll, importAll, type Backup } from "../lib/db";
import { speechSupported } from "../lib/narrator";
import { RATES } from "./PlayerBar";

export function SettingsView() {
  const { settings, updateSettings, voices, reloadReadings } = useStore();
  const [keyDraft, setKeyDraft] = useState(settings.apiKey);
  const [msg, setMsg] = useState("");

  const preview = () => {
    const u = new SpeechSynthesisUtterance("Airpower is targeting; targeting is intelligence; intelligence is analyzing the effects of air operations.");
    const v = voices.find((x) => x.voiceURI === settings.voiceURI);
    if (v) u.voice = v;
    u.rate = settings.rate;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  };

  return (
    <section>
      <h1>Settings</h1>
      <div className="card">
        <h2>Narration</h2>
        {!speechSupported() && <p className="error">This browser doesn't support speech synthesis. Try Chrome, Edge, or Safari.</p>}
        <label>
          Voice <span className="muted small">(“Natural”/“Online” voices in Edge and “Enhanced/Premium” voices on Apple devices sound best)</span>
          <select value={settings.voiceURI} onChange={(e) => updateSettings({ voiceURI: e.target.value })}>
            <option value="">Default</option>
            {voices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
        </label>
        <label>
          Speed: {settings.rate}×
          <input type="range" min={0.75} max={3.5} step={0.05} value={settings.rate} onChange={(e) => updateSettings({ rate: Number(e.target.value) })} />
        </label>
        <div className="row">
          {RATES.map((r) => (
            <button key={r} className={settings.rate === r ? "active" : ""} onClick={() => updateSettings({ rate: r })}>{r}×</button>
          ))}
          <button onClick={preview}>Preview</button>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={settings.autoContinue} onChange={(e) => updateSettings({ autoContinue: e.target.checked })} />
          Auto-continue to the next unfinished reading
        </label>
      </div>

      <div className="card">
        <h2>Pace</h2>
        <label>
          Finish all readings by
          <input type="date" value={settings.targetDate} onChange={(e) => updateSettings({ targetDate: e.target.value })} />
        </label>
      </div>

      <div className="card">
        <h2>AI study tools</h2>
        <p className="muted small">
          Briefs, practice quizzes, Q&amp;A, and the writing coach use the Claude API with your own key from{" "}
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>.
          The key is stored only in this browser. Reading text you run these tools on is sent to Anthropic's API, so
          only use them on material you're permitted to share outside government systems.
        </p>
        <div className="row">
          <input className="grow" type="password" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} placeholder="sk-ant-…" autoComplete="off" />
          <button className="primary" onClick={() => { updateSettings({ apiKey: keyDraft.trim() }); setMsg("API key saved."); }}>Save key</button>
          {settings.apiKey && <button onClick={() => { updateSettings({ apiKey: "" }); setKeyDraft(""); setMsg("API key removed."); }}>Remove</button>}
        </div>
      </div>

      <div className="card">
        <h2>Backup</h2>
        <p className="muted small">Everything lives in this browser. Export a backup to move devices or keep it safe.</p>
        <div className="row">
          <button
            onClick={async () => {
              const blob = new Blob([JSON.stringify(await exportAll())], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `acsc-speedrun-${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            Export backup
          </button>
          <label className="button">
            Import backup
            <input
              type="file"
              accept=".json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  await importAll(JSON.parse(await f.text()) as Backup);
                  await reloadReadings();
                  setMsg("Backup imported. Reload the page to see tasks and papers.");
                } catch (err) {
                  setMsg(`Import failed: ${err instanceof Error ? err.message : err}`);
                }
              }}
            />
          </label>
        </div>
      </div>
      {msg && <p className="notice">{msg}</p>}
    </section>
  );
}
