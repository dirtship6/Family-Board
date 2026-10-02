// Records every Claude call's token usage and turns it into dollars at list prices.
// Your Anthropic Console bill is authoritative; this is a close running estimate.
import * as db from "./db";
import type { Settings } from "./types";

export interface UsageRecord {
  id: string;
  at: number;
  /** What the call was for, e.g. "Ask: answer" or "Paper: Review my draft". */
  feature: string;
  model: string;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  cost: number;
}

/** $ per million tokens: input, output, and cache-read multiplier of the input price. */
const PRICES: { match: RegExp; input: number; output: number; cacheRead: number }[] = [
  { match: /^claude-opus-5-5/, input: 4, output: 20, cacheRead: 0.05 },
  { match: /^claude-(fable|mythos)-5-1/, input: 10, output: 50, cacheRead: 0.025 },
  { match: /^claude-(fable|mythos)-5\b/, input: 10, output: 50, cacheRead: 0.1 },
  { match: /^claude-opus-(5|4-[678])\b/, input: 5, output: 25, cacheRead: 0.1 },
  { match: /^claude-sonnet-5-5/, input: 2, output: 10, cacheRead: 0.1 },
  { match: /^claude-sonnet-5\b/, input: 2, output: 10, cacheRead: 0.1 },
  { match: /^claude-sonnet-4-6/, input: 3, output: 15, cacheRead: 0.1 },
  { match: /^claude-haiku-4-5/, input: 1, output: 5, cacheRead: 0.1 },
];
const CACHE_WRITE = 1.25; // 5-minute cache entries

export function priceFor(model: string) {
  return PRICES.find((p) => p.match.test(model)) ?? PRICES[0];
}

export function costOf(model: string, u: { input: number; output: number; cacheWrite: number; cacheRead: number }): number {
  const p = priceFor(model);
  return (
    (u.input * p.input + u.cacheWrite * p.input * CACHE_WRITE + u.cacheRead * p.input * p.cacheRead + u.output * p.output) /
    1_000_000
  );
}

type ApiUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

let listeners: (() => void)[] = [];
export function onUsage(fn: () => void): () => void {
  listeners.push(fn);
  return () => (listeners = listeners.filter((l) => l !== fn));
}

export async function recordUsage(feature: string, model: string, usage: ApiUsage): Promise<UsageRecord> {
  const u = {
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
  };
  const rec: UsageRecord = { id: db.newId(), at: Date.now(), feature, model, ...u, cost: costOf(model, u) };
  try {
    await db.put("usage", rec);
  } catch {
    // Never let bookkeeping break a successful answer.
  }
  listeners.forEach((l) => l());
  return rec;
}

export function monthStart(d = new Date()): number {
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export async function spentThisMonth(): Promise<number> {
  const start = monthStart();
  return (await db.all("usage")).filter((r) => r.at >= start).reduce((n, r) => n + r.cost, 0);
}

function readSettings(): Partial<Settings> {
  try {
    return JSON.parse(localStorage.getItem("acsc-speedrun.settings") ?? "{}");
  } catch {
    return {};
  }
}

/** Throws before a call when the user chose to enforce a monthly limit and has reached it. */
export async function assertWithinBudget(): Promise<void> {
  const s = readSettings();
  if (!s.enforceBudget || !s.monthlyBudget) return;
  const spent = await spentThisMonth();
  if (spent >= s.monthlyBudget) {
    throw new Error(
      `Monthly AI limit reached ($${spent.toFixed(2)} of $${s.monthlyBudget.toFixed(2)}). Raise or turn off the limit on the Costs page.`,
    );
  }
}

export function formatUsd(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export function toCsv(records: UsageRecord[]): string {
  const rows = [["date", "feature", "model", "input_tokens", "output_tokens", "cache_write_tokens", "cache_read_tokens", "cost_usd"]];
  for (const r of [...records].sort((a, b) => a.at - b.at)) {
    rows.push([new Date(r.at).toISOString(), r.feature, r.model, String(r.input), String(r.output), String(r.cacheWrite), String(r.cacheRead), r.cost.toFixed(6)]);
  }
  return rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");
}

// --- Narration estimates for premium voices -----------------------------------

export interface VoiceRates {
  /** Azure neural voices, $ per million characters. */
  azurePerMillion: number;
  /** ElevenLabs, $ per thousand characters (Pro plan: $99 / 600K ≈ $0.165). */
  elevenPerThousand: number;
}

export const DEFAULT_VOICE_RATES: VoiceRates = { azurePerMillion: 15, elevenPerThousand: 0.165 };

export function narrationCost(chars: number, rates: VoiceRates) {
  return { azure: (chars / 1_000_000) * rates.azurePerMillion, eleven: (chars / 1000) * rates.elevenPerThousand };
}
