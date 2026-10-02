import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import * as db from "../lib/db";
import {
  DEFAULT_VOICE_RATES,
  formatUsd,
  monthStart,
  narrationCost,
  onUsage,
  toCsv,
  type UsageRecord,
  type VoiceRates,
} from "../lib/usage";

const RATES_KEY = "acsc-speedrun.voiceRates";
/** Average characters per narrated word, including the space. */
const CHARS_PER_WORD = 6;

function loadRates(): VoiceRates {
  try {
    return { ...DEFAULT_VOICE_RATES, ...JSON.parse(localStorage.getItem(RATES_KEY) ?? "{}") };
  } catch {
    return DEFAULT_VOICE_RATES;
  }
}

export function useUsage() {
  const [records, setRecords] = useState<UsageRecord[]>([]);
  useEffect(() => {
    const load = () => void db.all("usage").then(setRecords);
    load();
    return onUsage(load);
  }, []);
  return { records, setRecords };
}

/** Banner for AI screens when the monthly limit is near or reached. */
export function BudgetBanner() {
  const { settings, go } = useStore();
  const { records } = useUsage();
  if (!settings.monthlyBudget) return null;
  const spent = records.filter((r) => r.at >= monthStart()).reduce((n, r) => n + r.cost, 0);
  const pct = spent / settings.monthlyBudget;
  if (pct < 0.8) return null;
  return (
    <p className={pct >= 1 ? "notice warn" : "notice"}>
      {pct >= 1 ? "Monthly AI limit reached" : "Approaching your monthly AI limit"}: {formatUsd(spent)} of{" "}
      {formatUsd(settings.monthlyBudget)}
      {pct >= 1 && settings.enforceBudget ? " — AI tools are paused." : "."}{" "}
      <button className="link" onClick={() => go("costs")}>See costs</button>
    </p>
  );
}

function Tile({ n, label }: { n: string; label: string }) {
  return (
    <div className="stat">
      <div className="n">{n}</div>
      <div className="l">{label}</div>
    </div>
  );
}

export function Costs() {
  const { settings, updateSettings, readings } = useStore();
  const { records, setRecords } = useUsage();
  const [rates, setRates] = useState<VoiceRates>(loadRates);
  const setRate = (patch: Partial<VoiceRates>) => {
    const next = { ...rates, ...patch };
    setRates(next);
    localStorage.setItem(RATES_KEY, JSON.stringify(next));
  };

  const now = new Date();
  const thisMonth = monthStart(now);
  const lastMonth = monthStart(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const sum = (list: UsageRecord[]) => list.reduce((n, r) => n + r.cost, 0);
  const monthRecs = records.filter((r) => r.at >= thisMonth);
  const spentMonth = sum(monthRecs);
  const spentLast = sum(records.filter((r) => r.at >= lastMonth && r.at < thisMonth));
  const asks = monthRecs.filter((r) => r.feature.startsWith("Ask"));

  const byFeature = useMemo(() => {
    const m = new Map<string, { calls: number; input: number; output: number; cost: number }>();
    for (const r of monthRecs) {
      const key = r.feature.startsWith("Ask") ? "Ask the readings" : r.feature;
      const v = m.get(key) ?? { calls: 0, input: 0, output: 0, cost: 0 };
      v.calls += key === "Ask the readings" && r.feature !== "Ask: answer" ? 0 : 1;
      v.input += r.input + r.cacheWrite + r.cacheRead;
      v.output += r.output;
      v.cost += r.cost;
      m.set(key, v);
    }
    return [...m.entries()].sort((a, b) => b[1].cost - a[1].cost);
  }, [monthRecs]);

  const byMonth = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of records) {
      const d = new Date(r.at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      m.set(key, (m.get(key) ?? 0) + r.cost);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [records]);

  const narration = useMemo(() => {
    const words = (list: typeof readings) => list.reduce((n, r) => n + (r.listenWords ?? r.wordCount), 0);
    const all = words(readings) * CHARS_PER_WORD;
    const left = words(readings.filter((r) => !r.completed)) * CHARS_PER_WORD;
    return { all, left, allCost: narrationCost(all, rates), leftCost: narrationCost(left, rates) };
  }, [readings, rates]);

  const budgetPct = settings.monthlyBudget ? Math.min(1, spentMonth / settings.monthlyBudget) : 0;
  const askAvg = asks.length ? sum(asks) / Math.max(asks.filter((r) => r.feature === "Ask: answer").length, 1) : 0;

  return (
    <section>
      <h1>Costs</h1>
      <div className="stats">
        <Tile n={formatUsd(spentMonth)} label={`AI this month (${now.toLocaleString(undefined, { month: "long" })})`} />
        <Tile n={formatUsd(spentLast)} label="AI last month" />
        <Tile n={formatUsd(sum(records))} label="AI all time" />
      </div>

      <div className="card">
        <h2>Monthly limit</h2>
        <div className="row wrap">
          <label className="grow">
            Limit in dollars (0 = no limit)
            <input
              type="number"
              min={0}
              step={1}
              value={settings.monthlyBudget}
              onChange={(e) => updateSettings({ monthlyBudget: Math.max(0, Number(e.target.value) || 0) })}
            />
          </label>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={settings.enforceBudget} onChange={(e) => updateSettings({ enforceBudget: e.target.checked })} />
          Pause the AI tools when the limit is reached (otherwise you just get a warning)
        </label>
        {settings.monthlyBudget > 0 && (
          <>
            <div className={`meter big${budgetPct >= 1 ? " over" : budgetPct >= 0.8 ? " near" : ""}`}>
              <div style={{ width: `${budgetPct * 100}%` }} />
            </div>
            <p className="muted small">
              {formatUsd(spentMonth)} of {formatUsd(settings.monthlyBudget)} used ({Math.round(budgetPct * 100)}%). Resets on the 1st.
            </p>
          </>
        )}
      </div>

      <div className="card">
        <h2>This month by feature</h2>
        {byFeature.length ? (
          <table className="data">
            <thead>
              <tr><th>Feature</th><th>Uses</th><th>Tokens in</th><th>Tokens out</th><th>Cost</th></tr>
            </thead>
            <tbody>
              {byFeature.map(([f, v]) => (
                <tr key={f}>
                  <td>{f}</td>
                  <td>{v.calls}</td>
                  <td>{v.input.toLocaleString()}</td>
                  <td>{v.output.toLocaleString()}</td>
                  <td>{formatUsd(v.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No AI use yet this month.</p>
        )}
        {askAvg > 0 && <p className="muted small">Average cost per Ask question: {formatUsd(askAvg)}</p>}
      </div>

      <div className="card">
        <h2>Narration</h2>
        <p>
          <strong>Current cost: $0.</strong> Narration uses your device's built-in voices, which are free.
        </p>
        <p className="muted small">
          What a premium voice would cost for your library, as narrated after listening cleanup (about{" "}
          {Math.round(narration.all / 1000).toLocaleString()}K characters; {Math.round(narration.left / 1000).toLocaleString()}K still unfinished).
          Audio would be generated once per reading and saved. Rates are list prices you can adjust.
        </p>
        <table className="data">
          <thead>
            <tr><th>Voice</th><th>Rate</th><th>Unfinished readings</th><th>Whole library</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Azure neural</td>
              <td>
                $<input className="rate" type="number" min={0} step={0.5} value={rates.azurePerMillion} onChange={(e) => setRate({ azurePerMillion: Number(e.target.value) || 0 })} /> / 1M chars
              </td>
              <td>{formatUsd(narration.leftCost.azure)}</td>
              <td>{formatUsd(narration.allCost.azure)}</td>
            </tr>
            <tr>
              <td>ElevenLabs</td>
              <td>
                $<input className="rate" type="number" min={0} step={0.005} value={rates.elevenPerThousand} onChange={(e) => setRate({ elevenPerThousand: Number(e.target.value) || 0 })} /> / 1K chars
              </td>
              <td>{formatUsd(narration.leftCost.eleven)}</td>
              <td>{formatUsd(narration.allCost.eleven)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {byMonth.length > 1 && (
        <div className="card">
          <h2>By month</h2>
          <table className="data">
            <tbody>
              {byMonth.map(([m, c]) => (
                <tr key={m}><td>{m}</td><td>{formatUsd(c)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2>Recent AI calls</h2>
        {records.length ? (
          <table className="data">
            <thead>
              <tr><th>When</th><th>Feature</th><th>Tokens in / out</th><th>Cost</th></tr>
            </thead>
            <tbody>
              {[...records].sort((a, b) => b.at - a.at).slice(0, 30).map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                  <td>
                    {r.feature}
                    {!r.model.startsWith("claude-opus-5-5") && <span className="muted small"> · answered by {r.model}</span>}
                  </td>
                  <td>{(r.input + r.cacheWrite + r.cacheRead).toLocaleString()} / {r.output.toLocaleString()}</td>
                  <td>{formatUsd(r.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">Nothing yet. Costs appear here as soon as you use a brief, Ask, or the writing coach.</p>
        )}
        <div className="actions">
          <button
            disabled={!records.length}
            onClick={() => {
              const blob = new Blob([toCsv(records)], { type: "text/csv" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `acsc-ai-costs-${new Date().toISOString().slice(0, 10)}.csv`;
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            Export CSV
          </button>
          <button
            className="danger"
            disabled={!records.length}
            onClick={async () => {
              if (!confirm("Clear the cost history on this device? Your Anthropic bill is unaffected.")) return;
              for (const r of records) await db.remove("usage", r.id);
              setRecords([]);
            }}
          >
            Clear history
          </button>
        </div>
        <p className="muted small">
          Estimated from token counts at list prices (Claude Opus 5.5: $4 per million input tokens, $20 per million output;
          cached input is cheaper). Your <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noreferrer">Anthropic Console</a> bill is authoritative.
        </p>
      </div>
    </section>
  );
}
