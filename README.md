# ACSC Speedrun

A browser-based study companion for Air Command and Staff College. It's built to get you through the readings quickly while you still actually absorb them, and to keep quizzes, papers, and deadlines moving.

## What it does

**1. Listen to every reading with follow-along text**
- Import PDFs, Word (.docx), HTML, Markdown, or text files, or paste text or fetch a public URL. Group readings by course and set the play order.
- Narration uses your device's built-in voices. Speed goes from 0.75× to 3.5×, and you can switch voices.
- The current sentence (and word, where the voice supports it) is highlighted and auto-scrolls into view. Click any sentence to jump there. Turn the text off for listening-only mode, e.g. while driving or working out.
- A persistent player bar keeps narration going while you use other tabs. It has sentence and paragraph skip, and keyboard shortcuts: space to play/pause, ←/→ for sentences, ↑/↓ for paragraphs.
- Your position is saved, and narration auto-continues to the next unfinished reading.
- The Today view shows how much listening time is left at your speed and how many minutes a day you need to hit your finish date.

**2. Quizzes, papers, and tasks**
- **Reading briefs:** BLUF, thesis, key arguments, key terms, connections, likely-tested points, and seminar questions.
- **Practice quizzes** built from any set of readings, with explanations. There's a "missed questions" drill across all attempts, and you can retake old quizzes.
- **Ask the readings:** compare authors, explain concepts, or apply them to scenarios, with answers grounded in your library.
- **Paper workspace:** decode the prompt and rubric, pressure-test your thesis, organize your ideas, find verbatim evidence in your readings, get instructor-style feedback on your draft, and check your citations. It also builds Chicago/AU-style footnotes and bibliographies from your library, and tracks word count against the target.
- **Tasks:** due dates with overdue/soon flags. You can bulk-paste your schedule (`2026-10-14 | Airpower | quiz | Lesson 3 quiz`).

The AI features use Claude (`claude-opus-5-5`) through your own Anthropic API key.

## Academic integrity

The study tools are designed to *prepare* you. The writing coach gives feedback and structure, but it won't write paper prose for you to submit. Practice quizzes are for preparation, not for answering graded ones. Follow Air University's academic integrity policy and each course's generative-AI rules. If you're unsure, ask your instructor.

## Data and privacy

- Everything (readings, progress, papers, quizzes, tasks) is stored locally in your browser (IndexedDB). Use **Settings → Export backup** to move between devices.
- Your API key is stored in this browser's localStorage, and requests go directly from your browser to `api.anthropic.com`.
- When you use an AI tool, the text of the selected readings and your paper is sent to Anthropic. Only use these tools on material you're allowed to share outside government systems. Never use them on CUI or anything with distribution restrictions.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run build      # static site in dist/ — host anywhere (GitHub Pages, Netlify, etc.)
```

Tips:
- **Best voices:** Microsoft Edge's "Natural" voices are excellent and free. On Mac/iPhone, download "Enhanced" or "Premium" voices under Settings → Accessibility → Spoken Content.
- **Scanned PDFs** have no text layer. Run OCR on them first (e.g. in Acrobat or macOS Preview), then import.
- **Canvas pages** usually can't be fetched by URL. Open the page, select all, copy, and paste it in.
- Use **Library → Edit** to strip headers, footers, or endnotes you don't want read aloud, and to add author/publisher/year for citations.
