import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useStore } from "../store";
import * as db from "../lib/db";
import { testConnection } from "../lib/claude";
import { clearErrors, readErrors, type LoggedError } from "../lib/errorlog";
import { listenWordCount, repairLigatures } from "../lib/listening";
import { speechSupported } from "../lib/narrator";
import { formatUsd } from "../lib/usage";

type Status = "ok" | "warn" | "bad" | "info";
interface Check {
  id: string;
  label: string;
  status: Status;
  detail: string;
  action?: { label: string; run(): void | Promise<void> };
}

const ICON: Record<Status, string> = { ok: "●", warn: "▲", bad: "✕", info: "○" };
const NATURAL = /natural|online|neural|enhanced|premium/i;

function mb(bytes: number) {
  return bytes > 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

function daysAgo(t: number) {
  const d = Math.floor((Date.now() - t) / 86_400_000);
  return d === 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}

export function Help() {
  const { readings, voices, settings, narrator, saveReading, go, notes } = useStore();
  const [checks, setChecks] = useState<Check[]>([]);
  const [errors, setErrors] = useState<LoggedError[]>(readErrors);
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState("");

  const runChecks = useCallback(async () => {
    const out: Check[] = [];
    // Narration
    if (!speechSupported()) {
      out.push({ id: "speech", label: "Speech engine", status: "bad", detail: "This browser can't read aloud. Use Chrome, Edge, or Safari." });
    } else {
      const natural = voices.filter((v) => v.lang.startsWith("en") && NATURAL.test(v.name));
      out.push({
        id: "speech",
        label: "Speech engine",
        status: voices.length ? (natural.length ? "ok" : "warn") : "warn",
        detail: voices.length
          ? `${voices.length} voices, ${natural.length} high-quality English ("Natural"/"Enhanced").${natural.length ? "" : " Microsoft Edge has free Natural voices; on iPhone/Mac download Enhanced voices in Settings → Accessibility → Spoken Content."}`
          : "No voices reported yet. Reload the page; some browsers load voices late.",
      });
    }
    // Storage
    try {
      const est = await navigator.storage?.estimate?.();
      const persisted = await navigator.storage?.persisted?.();
      const used = est?.usage ?? 0;
      const quota = est?.quota ?? 0;
      const tight = quota && used / quota > 0.8;
      out.push({
        id: "storage",
        label: "On-device storage",
        status: tight ? "warn" : "ok",
        detail: `${mb(used)} used${quota ? ` of ${mb(quota)} available` : ""}. ${persisted ? "Protected from automatic cleanup." : "Not yet protected: the browser could clear it if the device runs low on space."}`,
        action: persisted
          ? undefined
          : {
              label: "Protect storage",
              run: async () => {
                const ok = await navigator.storage?.persist?.();
                setResult(ok ? "Storage is now protected." : "The browser declined. Installing the app to your home screen or bookmarking it usually helps; keep backups either way.");
                void runChecks();
              },
            },
      });
    } catch {
      out.push({ id: "storage", label: "On-device storage", status: "bad", detail: "Couldn't read storage. Private/incognito windows often block it; use a normal window." });
    }
    // Backup
    const last = Number(localStorage.getItem("acsc-speedrun.lastBackup") ?? 0);
    const hasData = readings.length > 0 || notes.length > 0;
    out.push({
      id: "backup",
      label: "Backup",
      status: !hasData ? "info" : !last ? "bad" : Date.now() - last > 14 * 86_400_000 ? "warn" : "ok",
      detail: last ? `Last backup ${daysAgo(last)}.` : hasData ? "No backup yet. Everything lives only in this browser." : "Nothing to back up yet.",
      action: hasData ? { label: "Back up now", run: () => go("settings") } : undefined,
    });
    // AI
    out.push({
      id: "ai",
      label: "AI tools (Claude)",
      status: settings.apiKey ? "info" : "warn",
      detail: settings.apiKey ? "API key saved. Run a quick test to confirm it works (costs a fraction of a cent)." : "No API key yet; briefs, Ask, and the writing coach are off.",
      action: settings.apiKey
        ? {
            label: "Test connection",
            run: async () => {
              setBusy("Testing connection…");
              try {
                const r = await testConnection(settings.apiKey);
                setResult(`Connected: ${r.model} answered in ${(r.ms / 1000).toFixed(1)}s for ${formatUsd(r.cost)}.`);
              } catch (e) {
                setResult(`Connection failed: ${e instanceof Error ? e.message : e}`);
              }
              setBusy("");
              setErrors(readErrors());
            },
          }
        : { label: "Add key", run: () => go("settings") },
    });
    out.push({
      id: "net",
      label: "Network",
      status: navigator.onLine ? "ok" : "warn",
      detail: navigator.onLine ? "Online." : "Offline. Listening, search, and notes still work; AI tools need a connection.",
    });
    // Library content
    const thin = readings.filter((r) => r.wordCount < 80 && !/^lesson|^course/i.test(r.title));
    out.push({
      id: "thin",
      label: "Readings with little or no text",
      status: thin.length ? "warn" : "ok",
      detail: thin.length
        ? `${thin.map((r) => `“${r.title}” (${r.wordCount} words)`).join(", ")}. Usually a scanned PDF: run text recognition (OCR) on it and re-import.`
        : `All ${readings.length} readings have text.`,
    });
    out.push({
      id: "cleanup",
      label: "Listening cleanup",
      status: settings.listeningCleanup ? "ok" : "info",
      detail: settings.listeningCleanup
        ? "On: reference lists, notes, tables, citations, footnote numbers, and web addresses are skipped while listening."
        : "Off: everything is read aloud, including reference lists and citations.",
      action: settings.listeningCleanup ? undefined : { label: "Turn on", run: () => go("settings") },
    });
    setChecks(out);
  }, [voices, readings, notes.length, settings.apiKey, settings.listeningCleanup, go]);

  useEffect(() => {
    void runChecks();
  }, [runChecks]);

  const repairAll = async () => {
    setBusy("Scanning readings for damaged words…");
    let fixed = 0;
    let docs = 0;
    for (const r of readings) {
      const others = readings.filter((x) => x.id !== r.id).map((x) => x.text);
      const out = repairLigatures(r.text, others);
      if (out.fixes) {
        fixed += out.fixes;
        docs++;
        await saveReading({ ...r, text: out.text, listenWords: listenWordCount(out.text) });
      }
    }
    setBusy("");
    setResult(fixed ? `Repaired ${fixed} damaged words in ${docs} reading${docs === 1 ? "" : "s"}.` : "No damaged text found.");
  };

  const recalc = async () => {
    setBusy("Recalculating listening times…");
    for (const r of readings) await saveReading({ ...r, listenWords: listenWordCount(r.text) });
    setBusy("");
    setResult("Listening times updated.");
  };

  const report = async () => {
    const counts = {
      readings: readings.length,
      words: readings.reduce((n, r) => n + r.wordCount, 0),
      images: await db.imageCount(),
      notes: notes.length,
      tasks: (await db.all("tasks")).length,
      papers: (await db.all("papers")).length,
      aiCalls: (await db.all("usage")).length,
    };
    const { apiKey: _omit, ...safeSettings } = settings;
    const text = JSON.stringify(
      {
        app: "ACSC Speedrun",
        at: new Date().toISOString(),
        browser: navigator.userAgent,
        online: navigator.onLine,
        settings: { ...safeSettings, apiKeySet: Boolean(settings.apiKey) },
        voices: voices.length,
        checks: checks.map(({ label, status, detail }) => ({ label, status, detail })),
        counts,
        recentErrors: errors.slice(0, 30),
      },
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(text);
      setResult("Diagnostic report copied. It has no reading text, notes, or API key. Paste it to whoever is helping you.");
    } catch {
      setResult(text);
    }
  };

  return (
    <section>
      <h1>Help</h1>

      <div className="card">
        <h2>
          Health check <button className="link small" onClick={() => void runChecks()}>run again</button>
        </h2>
        <ul className="checks">
          {checks.map((c) => (
            <li key={c.id} className={`check ${c.status}`}>
              <span className="check-icon" aria-hidden>{ICON[c.status]}</span>
              <div className="grow">
                <div className="strong">{c.label}</div>
                <div className="small">{c.detail}</div>
              </div>
              {c.action && (
                <button disabled={!!busy} onClick={() => void c.action!.run()}>
                  {c.action.label}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2>Fixes</h2>
        <div className="tool-grid">
          <Tool title="Narration stuck or silent" body="Stops the speech engine and resets the player. Press play again afterwards.">
            <button
              onClick={() => {
                narrator.stop();
                if (speechSupported()) speechSynthesis.cancel();
                setResult("Speech engine reset. Press play to continue where you were.");
              }}
            >
              Reset narration
            </button>
          </Tool>
          <Tool title="Strange words read aloud" body={'Repairs words some PDFs damage ("Te" for "The", "ofcer" for "officer") across your whole library.'}>
            <button disabled={!!busy || !readings.length} onClick={() => void repairAll()}>Repair damaged text</button>
          </Tool>
          <Tool title="Time estimates look wrong" body="Recomputes how long each reading takes to listen to after cleanup.">
            <button disabled={!!busy || !readings.length} onClick={() => void recalc()}>Recalculate</button>
          </Tool>
          <Tool title="Getting help" body="Copies a report of these checks and recent errors, with no reading text, notes, or API key.">
            <button onClick={() => void report()}>Copy diagnostic report</button>
          </Tool>
        </div>
        {busy && <p className="muted">{busy}</p>}
        {result && <p className="notice small" style={{ whiteSpace: "pre-wrap" }}>{result}</p>}
      </div>

      <div className="card">
        <h2>
          Recent problems{" "}
          {errors.length > 0 && (
            <button
              className="link small"
              onClick={() => {
                clearErrors();
                setErrors([]);
              }}
            >
              clear
            </button>
          )}
        </h2>
        {errors.length ? (
          <table className="data">
            <tbody>
              {errors.slice(0, 25).map((e, i) => (
                <tr key={i}>
                  <td className="nowrap">{new Date(e.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                  <td>{e.area}</td>
                  <td>{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No problems logged.</p>
        )}
      </div>

      <div className="card faq">
        <h2>Common issues</h2>
        <Faq q="Narration stops when my phone locks or I switch apps">
          Built-in voices are paused by the phone whenever the browser isn't in front. It's a phone limitation, not a bug. Keep the screen on
          while listening for now; background listening needs the premium-voice option (audio files), which is planned.
        </Faq>
        <Faq q="Narration stops by itself after a while on a computer">
          Some browsers pause speech in background tabs. Click <strong>Reset narration</strong> above, then play. Switching to a different
          voice in Settings also helps; the "Natural"/"Online" voices in Edge are the most reliable.
        </Faq>
        <Faq q="A PDF imported with no text, or a reading is nearly empty">
          It's probably a scanned image of pages. Run text recognition (OCR) on it, e.g. in Adobe Acrobat ("Scan &amp; OCR") or by opening
          it in Preview on a Mac and exporting, then import it again.
        </Faq>
        <Faq q="Lessons from my course download are empty">
          Canvas only includes lessons that were unlocked when you downloaded. Download the course again after they unlock and drop in the
          new zip; anything already imported is skipped.
        </Faq>
        <Faq q="It's reading reference lists, citations, or web addresses">
          Make sure <strong>Listening cleanup</strong> is on in Settings. If a particular reading still reads its references, the section
          probably has no recognizable heading; tap the next paragraph to skip ahead, and let us know via the diagnostic report.
        </Faq>
        <Faq q="It says strange words like “Te” or “ofcer”">
          The PDF lost some letter pairs in its fonts. New imports are repaired automatically; use <strong>Repair damaged text</strong> above
          for anything imported earlier.
        </Faq>
        <Faq q="AI error: “API key was rejected”">
          Re-copy the key from console.anthropic.com → API Keys and save it again in Settings. Make sure the key hasn't been deleted and the
          account has credit.
        </Faq>
        <Faq q="AI error: “rate limited” or “temporary problem”">
          Too many requests in a short time, or Anthropic's service is busy. Wait a minute and try again. Nothing is lost.
        </Faq>
        <Faq q="AI error: “monthly AI limit reached”">
          You set a monthly limit on the Costs page and reached it. Raise it, or turn off "pause the AI tools", on the Costs page.
        </Faq>
        <Faq q="My readings or notes disappeared">
          The browser's site data was cleared, or you're in a private window or a different browser. Restore your latest backup in Settings →
          Import backup. Use <strong>Protect storage</strong> above and back up regularly.
        </Faq>
        <Faq q="Choosing the same file again does nothing">
          Fixed: the importer now accepts the same file twice and skips anything already in your library. Reload the page if you still see it.
        </Faq>
      </div>
    </section>
  );
}

function Tool({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  return (
    <div className="tool">
      <div className="strong">{title}</div>
      <p className="small muted">{body}</p>
      {children}
    </div>
  );
}

function Faq({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details>
      <summary>{q}</summary>
      <p className="small">{children}</p>
    </details>
  );
}
