// Thin wrapper around the Anthropic SDK for the study tools.
// The API key is stored only in this browser (localStorage) and requests go
// straight from the browser to the Anthropic API.
import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlockParam, BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { Passage } from "./retrieve";
import type { Paper, Reading, StudyBrief } from "./types";

const MODEL = "claude-opus-5-5";
const BETAS = ["server-side-fallback-2026-07-01"];

type Effort = "low" | "medium" | "high";

const COACH_SYSTEM = `You are a study coach for an officer completing Air Command and Staff College (ACSC), Air University's intermediate developmental education program.
Your job is to help them understand the assigned readings faster and more deeply, prepare for assessments, and become a better writer.
Ground every answer in the readings provided. When a claim comes from a reading, name the reading. If the readings don't support something, say so instead of inventing it.
Be direct and concise, in the BLUF style used in military writing.`;

let client: Anthropic | null = null;
let clientKey = "";

function getClient(apiKey: string): Anthropic {
  if (!apiKey) throw new Error("Add your Anthropic API key in Settings to use the AI study tools.");
  if (!client || clientKey !== apiKey) {
    client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    clientKey = apiKey;
  }
  return client;
}

/** Readings go first and are cached so repeated actions on the same set are cheap. */
function readingBlocks(readings: Reading[]): BetaContentBlockParam[] {
  if (!readings.length) return [];
  const body = readings
    .map((r) => `<reading title="${r.title.replace(/"/g, "'")}"${r.author ? ` author="${r.author.replace(/"/g, "'")}"` : ""}>\n${r.text}\n</reading>`)
    .join("\n\n");
  return [{ type: "text", text: `<readings>\n${body}\n</readings>`, cache_control: { type: "ephemeral" } }];
}

function textOf(msg: BetaMessage): string {
  if (msg.stop_reason === "refusal") throw new Error("The model declined this request.");
  if (msg.stop_reason === "max_tokens") throw new Error("The response was cut off. Try fewer readings or a narrower request.");
  return msg.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");
}

function describeError(e: unknown): Error {
  if (e instanceof Anthropic.AuthenticationError) return new Error("Your API key was rejected. Check it in Settings.");
  if (e instanceof Anthropic.RateLimitError) return new Error("Rate limited by the API. Wait a minute and try again.");
  if (e instanceof Anthropic.BadRequestError) return new Error(`Request rejected: ${e.message}`);
  if (e instanceof Anthropic.APIConnectionError) return new Error("Couldn't reach the Anthropic API. Check your connection.");
  return e instanceof Error ? e : new Error(String(e));
}

async function askJSON<T>(opts: {
  apiKey: string;
  readings: Reading[];
  instruction: string;
  schema: Record<string, unknown>;
  effort?: Effort;
  system?: string;
}): Promise<T> {
  try {
    const stream = getClient(opts.apiKey).beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      betas: BETAS,
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: opts.effort ?? "medium", format: { type: "json_schema", schema: opts.schema } },
      system: opts.system ?? COACH_SYSTEM,
      messages: [{ role: "user", content: [...readingBlocks(opts.readings), { type: "text", text: opts.instruction }] }],
    });
    return JSON.parse(textOf(await stream.finalMessage())) as T;
  } catch (e) {
    throw describeError(e);
  }
}

/** Streams plain-text answers so long feedback shows up as it is written. */
export async function askText(opts: {
  apiKey: string;
  readings: Reading[];
  instruction: string;
  onText: (soFar: string) => void;
  effort?: Effort;
  system?: string;
}): Promise<string> {
  try {
    const stream = getClient(opts.apiKey).beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      betas: BETAS,
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: opts.effort ?? "medium" },
      system: opts.system ?? COACH_SYSTEM,
      messages: [{ role: "user", content: [...readingBlocks(opts.readings), { type: "text", text: opts.instruction }] }],
    });
    let soFar = "";
    stream.on("text", (delta) => {
      soFar += delta;
      opts.onText(soFar);
    });
    return textOf(await stream.finalMessage());
  } catch (e) {
    throw describeError(e);
  }
}

const strArray = { type: "array", items: { type: "string" } };

export function generateBrief(apiKey: string, reading: Reading): Promise<StudyBrief> {
  return askJSON<StudyBrief>({
    apiKey,
    readings: [reading],
    effort: "medium",
    instruction: `Build a study brief for the reading "${reading.title}" that lets me walk into seminar ready to discuss it.
- bluf: 2-3 sentence bottom line.
- thesis: the author's central argument in one sentence.
- keyArguments: the 4-7 load-bearing arguments or findings, each one sentence.
- keyTerms: concepts, doctrine terms, people, or events I must be able to define.
- connections: links to airpower theory, joint doctrine, strategy, or leadership themes common in ACSC.
- discussionQuestions: 4-5 seminar-quality questions, including at least one that challenges the author.
- likelyTested: 3-5 points an instructor would most likely test.`,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["bluf", "thesis", "keyArguments", "keyTerms", "connections", "discussionQuestions", "likelyTested"],
      properties: {
        bluf: { type: "string" },
        thesis: { type: "string" },
        keyArguments: strArray,
        keyTerms: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["term", "definition"],
            properties: { term: { type: "string" }, definition: { type: "string" } },
          },
        },
        connections: strArray,
        discussionQuestions: strArray,
        likelyTested: strArray,
      },
    },
  });
}

const PAPER_SYSTEM = `${COACH_SYSTEM}
You are acting as a writing coach, like Air University's writing center. The student is the author of their paper.
Help them understand the assignment, sharpen their own thesis, organize their own ideas, find evidence in the readings, and improve their draft through specific feedback.
Do not write paragraphs of paper prose for them to submit. When an example helps, keep it to a single illustrative sentence and label it as an example.
Use the Air University Style and Author Guide conventions (Chicago notes-bibliography) when discussing citations.`;

function paperContext(p: Paper): string {
  return `<assignment title="${p.title.replace(/"/g, "'")}" word_target="${p.wordTarget || "unspecified"}">
<prompt>
${p.prompt || "(not provided)"}
</prompt>
<rubric>
${p.rubric || "(not provided)"}
</rubric>
</assignment>
<my_thesis>
${p.thesis || "(not written yet)"}
</my_thesis>
<my_outline>
${p.outline || "(not written yet)"}
</my_outline>`;
}

export const PAPER_ACTIONS = {
  decode: {
    label: "Decode the prompt",
    hint: "What's actually being asked, the hidden requirements, and a rubric checklist.",
    effort: "medium" as Effort,
    build: (p: Paper) => `${paperContext(p)}

Decode this assignment for me:
1. BLUF: what the instructor is really asking, in one sentence.
2. Required elements (explicit and implied), as a checklist I can grade myself against.
3. Rubric translated into concrete "an A paper does X" statements.
4. Common ways students miss the mark on prompts like this.
5. Which of the attached readings are most relevant and why.`,
  },
  thesis: {
    label: "Pressure-test my thesis",
    hint: "Critique of your thesis: arguable? specific? answers the prompt? Strongest counterarguments.",
    effort: "high" as Effort,
    build: (p: Paper) => `${paperContext(p)}

Pressure-test my thesis. Tell me whether it is arguable, specific, and directly answers the prompt.
Give the three strongest counterarguments a skeptical instructor would raise, with which reading supports each.
Then ask me 3 pointed questions that would help me sharpen it. Do not rewrite the thesis for me.`,
  },
  outline: {
    label: "Organize my ideas",
    hint: "Suggests a structure for your thesis and maps reading evidence to each section.",
    effort: "high" as Effort,
    build: (p: Paper) => `${paperContext(p)}

Suggest a structure for a paper that defends my thesis, sized to the word target (give a word budget per section).
For each section, state the job that section must do and list specific evidence from the readings I could use (reading title plus a short quote or paraphrase I can verify).
Point out gaps in my current outline. Keep section descriptions as bullet points, not prose.`,
  },
  evidence: {
    label: "Find evidence",
    hint: "Pulls quotes and facts from your selected readings that support or challenge your thesis.",
    effort: "medium" as Effort,
    build: (p: Paper) => `${paperContext(p)}

Find the best evidence in the readings for and against my thesis.
For each item give: the reading title, an exact short quote (copied verbatim from the reading so I can cite it), and one line on how it helps or hurts my argument.
Group into "Supports" and "Challenges". Aim for 8-12 items.`,
  },
  review: {
    label: "Review my draft",
    hint: "Instructor-style feedback against the rubric: grade estimate, top fixes, line-level notes.",
    effort: "high" as Effort,
    build: (p: Paper) => `${paperContext(p)}
<my_draft words="${p.draft.trim().split(/\s+/).filter(Boolean).length}">
${p.draft || "(empty)"}
</my_draft>

Review my draft the way a demanding ACSC instructor would, against the prompt and rubric.
1. BLUF and an estimated grade band with reasoning.
2. The 3-5 highest-impact fixes, in priority order.
3. Argument check: does every section serve the thesis? Where is evidence thin or analysis missing ("so what?")?
4. Line-level notes: quote the sentence, then explain the problem (clarity, passive voice, wordiness, unsupported claim, citation issue). Do not supply replacement paragraphs.
5. Word count versus target.`,
  },
  citations: {
    label: "Check citations",
    hint: "Checks footnotes and bibliography against Chicago / AU style.",
    effort: "low" as Effort,
    build: (p: Paper) => `${paperContext(p)}
<my_draft>
${p.draft || "(empty)"}
</my_draft>

Check the citations in my draft against Chicago notes-bibliography style as used in the Air University Style and Author Guide.
List each problem with the exact text, what's wrong, and the corrected citation format. Also flag claims that need a citation but don't have one.`,
  },
} as const;

export type PaperAction = keyof typeof PAPER_ACTIONS;

export function runPaperAction(
  apiKey: string,
  action: PaperAction,
  paper: Paper,
  sources: Reading[],
  onText: (s: string) => void,
): Promise<string> {
  const a = PAPER_ACTIONS[action];
  return askText({ apiKey, readings: sources, instruction: a.build(paper), onText, effort: a.effort, system: PAPER_SYSTEM });
}

/** Turns a question into extra search terms (synonyms, doctrine terms, names) for passage retrieval. */
export async function expandQuery(apiKey: string, question: string): Promise<string[]> {
  const out = await askJSON<{ terms: string[] }>({
    apiKey,
    readings: [],
    effort: "low",
    instruction: `A student is searching their Air Command and Staff College readings to answer this question:
"${question}"
List 6-12 search terms likely to appear in passages that answer it: key concepts, synonyms, related doctrine terms, theorists, and short phrases (1-3 words each). Don't repeat the question's own words.`,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["terms"],
      properties: { terms: strArray },
    },
  });
  return out.terms.slice(0, 15);
}

export interface ShortAnswer {
  /** 2-4 sentence bottom line. */
  answer: string;
  points: { point: string; sources: number[] }[];
  coverage: "answered" | "partial" | "not_found";
}

export function answerFromPassages(apiKey: string, question: string, passages: Passage[]): Promise<ShortAnswer> {
  const body = passages
    .map((p) => `<passage n="${p.n}" reading="${p.title.replace(/"/g, "'")}" course="${p.course.replace(/"/g, "'")}">\n${p.text}\n</passage>`)
    .join("\n");
  return askJSON<ShortAnswer>({
    apiKey,
    readings: [],
    effort: "low",
    instruction: `<passages>
${body}
</passages>

Question: ${question}

Answer using only the passages above, which were retrieved from the student's course readings.
- answer: the bottom line in 2-4 plain sentences.
- points: 2-5 short supporting points (one sentence each). sources lists the passage numbers each point relies on.
- If the passages only partly answer it, say what's missing in the answer and set coverage to "partial". If they don't answer it, set coverage to "not_found", say so briefly, and leave points empty.
Never add facts that aren't in the passages.`,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["answer", "points", "coverage"],
      properties: {
        answer: { type: "string" },
        points: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["point", "sources"],
            properties: { point: { type: "string" }, sources: { type: "array", items: { type: "integer" } } },
          },
        },
        coverage: { type: "string", enum: ["answered", "partial", "not_found"] },
      },
    },
  });
}
