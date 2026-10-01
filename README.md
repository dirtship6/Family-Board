# ACSC Speedrun

A browser-based study companion for Air Command and Staff College. It's built to get you through the readings quickly while you still actually absorb them, and to keep quizzes, papers, and deadlines moving.

## What it does

**1. Listen to every reading with follow-along text**
- Import PDFs, Word (.docx), HTML, Markdown, or text files, or paste text or fetch a public URL. Group readings by course and set the play order.
- Drop in a whole offline course download (.zip) or e-book (.epub). Every document or chapter becomes its own reading, in lesson order. Navigation and cover pages are skipped.
- **Canvas course downloads** (the ACSC/Global College "download course content" zip) get special handling:
  - Everything imports in the order the course presents it: each lesson page, then the readings that page assigns.
  - PDF file names become proper titles, authors and years for citations.
  - Each lesson page's videos and outside articles appear as links above its text.
  - Lesson images (diagrams, charts, photos) appear inline where the lesson places them; tap one to enlarge it. Narration skips them, and icons and reading thumbnails aren't imported. Images are stored on your device and included in backups.
  - Assignments and progress checks become Tasks, and each assignment's instructions pre-fill a Papers workspace, including the word limit when one is stated.
  - Running headers, page numbers, copyright footers and JSTOR stamps are stripped from PDFs.
  - Lessons that downloaded empty (still locked) are flagged. Importing a newer download later adds only what's new.
- Narration uses your device's built-in voices. Speed goes from 0.75× to 3.5×, and you can switch voices.
- The current sentence (and word, where the voice supports it) is highlighted and auto-scrolls into view. Click any sentence to jump there. Turn the text off for listening-only mode, e.g. while driving or working out.
- A persistent player bar keeps narration going while you use other tabs. It has sentence and paragraph skip, and keyboard shortcuts: space to play/pause, ←/→ for sentences, ↑/↓ for paragraphs.
- Your position is saved, and narration auto-continues to the next unfinished reading.
- The Today view shows how much listening time is left at your speed and how many minutes a day you need to hit your finish date.

**2. Search, study, papers, and tasks**
- **Search** across every reading at once, or filter to one course. Every word must appear in the same sentence; use "quotes" for exact phrases. Each hit shows its surrounding sentences, and you can jump to that spot to read or listen from there, or copy the quote with a footnote.
- **Notes — a running notebook for the whole degree.** Tap **☆ Note** in the player (or press `n`) to save the sentence being read, even while you're on another tab. You can also select any text in a reading, or save a search hit or an AI answer. Each note keeps its course, source, and a Chicago citation. You can widen a quote by a sentence, add your own take and tags, jump back to the source, search and filter, and export everything to Markdown (opens in Word, Google Docs, OneNote, or Obsidian).
- **Reading briefs:** BLUF, thesis, key arguments, key terms, connections, likely-tested points, and seminar questions.
- **Ask the readings:** ask a question in plain English about all your readings, one course, or the reading that's playing. It finds the most relevant passages, including ones that use different wording, and Claude gives a short answer: a 2–4 sentence bottom line plus a few supporting points. Each point cites its reading, and tapping the citation jumps to the exact sentence. Only the matching passages are sent to Claude, so each question is quick and cheap. You can save the answer, or any passage it used, to Notes.
- **Paper workspace:** decode the prompt and rubric, pressure-test your thesis, organize your ideas, find verbatim evidence in your readings, get instructor-style feedback on your draft, and check your citations. It also builds Chicago/AU-style footnotes and bibliographies from your library, and tracks word count against the target.
- **Tasks:** due dates with overdue/soon flags. You can bulk-paste your schedule (`2026-10-14 | Airpower | quiz | Lesson 3 quiz`).

The AI features use Claude (`claude-opus-5-5`) through your own Anthropic API key.

## Academic integrity

The study tools are designed to *prepare* you. The writing coach gives feedback and structure, but it won't write paper prose for you to submit. Follow Air University's academic integrity policy and each course's generative-AI rules. If you're unsure, ask your instructor.

## Data and privacy

- Everything (readings, progress, notes, papers, tasks) is stored locally in your browser (IndexedDB). Use **Settings → Export backup** to move between devices, and export a backup regularly: your notebook is meant to outlast the course.
- Your API key is stored in this browser's localStorage, and requests go directly from your browser to `api.anthropic.com`.
- When you use an AI tool, reading text is sent to Anthropic: the passages that match your question for Ask, or the whole reading or paper for briefs and the writing coach. Only use these tools on material you're allowed to share outside government systems. Never use them on CUI or anything with distribution restrictions.

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
