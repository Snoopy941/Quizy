# Quizy — quizy.study

**AI-powered study companion.** Upload a PDF (textbook chapter, lecture notes, article) and Quizy extracts the text, generates flashcards, and schedules them with spaced repetition (SM-2).

Monochrome black-and-white design, dark mode by default with a light toggle.

## Features

- **PDF → flashcards**: drag-and-drop upload (≤50MB), heading/paragraph-aware chunking, AI card generation with progress tracking
- **5 card types**: definition, fill-in-the-blank, multiple choice, true/false, short answer
- **AI controls**: card density (low/medium/high), per-deck custom instructions, per-card and per-section regeneration, full re-generate from PDF
- **Study sessions**: 3D card flip, keyboard shortcuts (Space flip, 1–4 grade, S skip, F focus, ? help), shuffle, focus mode, skip
- **Spaced repetition (SM-2)**: ease factor, intervals, due dates, lapses; "Due Today" counts everywhere; mastery = interval > 21 days
- **Timed review**: 5/10/15/30/60-minute countdown, cycles due cards then recycles the queue, session summary with weakest categories
- **Cross-deck "Today's Review"** queue at `/review`
- **Analytics**: per-deck stats, 30-day activity chart, mastery by category, session history, daily streak
- **Deck management**: rename, duplicate, pin, delete, CSV/JSON export, public share links
- **Auth**: email + password (bcrypt + JWT httpOnly cookie sessions)
- **Polish**: dark/light theme, sound effects toggle, confetti on session completion, 50-correct easter egg, onboarding checklist, empty states, mobile bottom tabs, resume after closing the tab mid-session

## Quick start (local)

```bash
npm install
npx prisma migrate deploy   # creates data/quizy.db
npm run dev                 # http://localhost:4000
```

`MOCK_AI=1` is set by default in `.env`, so card generation works offline with a deterministic sample generator. For real AI generation, set:

```bash
OPENAI_API_KEY=sk-...
# optional:
OPENAI_BASE_URL=https://openrouter.ai/api/v1   # any OpenAI-compatible endpoint
OPENAI_MODEL=gpt-4o-mini
MOCK_AI=0
```

Generate a test PDF with `npm run sample-pdf` (writes `data/sample.pdf`).

## Run it like a desktop app (Windows)

No install needed — build the portable folder once, then just double-click:

```bash
npx next build            # standalone build
bash scripts/build-portable.sh   # assembles dist/Quizy (see script)
```

Then open `dist\Quizy\Quizy.exe`:

- Opens Quizy in its own app window (no browser tabs, no address bar)
- Runs a private local server on `127.0.0.1:3927` — nothing is exposed to the network
- All data (database + uploaded PDFs) lives in `dist\Quizy\data\` — copy the folder to move it
- Demo login: `demo@quizy.study` / `password123` (or create your own account)
- Close the window to stop it, or use `Quit Quizy.exe` from the system tray flow
- Real AI generation: put `OPENAI_API_KEY=sk-...` in `dist\Quizy\app\.env`, then restart

## Windows installer (for distribution)

Build the real installer — license screen, desktop + Start Menu shortcuts, launch-on-finish, uninstaller:

```bash
bash scripts/build-installer.sh
# → installer-out/Quizy-Setup-1.0.0.exe  (~126 MB, NSIS)
```

What installers get: per-user install to `%LOCALAPPDATA%\Programs\Quizy`, a first-run seed (demo account `demo@quizy.study` / `password123` + sample PDFs), user data in `%APPDATA%\Quizy` that survives updates and uninstall, full version/copyright metadata, and the branded icon on every binary.

To distribute: host `Quizy-Setup-1.0.0.exe` (e.g. `https://quizy.study/downloads/Quizy-Setup.exe`) and link it from the site. Note: the exe is **unsigned**, so Windows SmartScreen will show "unknown publisher" — buyers of a code-signing certificate can drop the cert into `installer/` and set `CSC_LINK`/`CSC_KEY_PASSWORD` to sign automatically.

## Docker (as chosen for deployment)

```bash
JWT_SECRET=$(openssl rand -hex 32) docker compose up --build -d
# → http://localhost:4000
```

SQLite database and uploaded PDFs persist in the `quizy-data` volume. Set `OPENAI_API_KEY` and `MOCK_AI=0` in the compose environment for real AI generation.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Dashboard: due today, streak, recent decks, onboarding |
| `/login`, `/signup` | Auth |
| `/library` | Deck grid with stats, pin/duplicate/export/share/delete |
| `/library/new` | Upload PDF → new deck |
| `/deck/:id` | Deck detail: card list, edit/reorder/regenerate, study |
| `/deck/:id/study` | Flashcard session (`?timed=10` for timed mode) |
| `/deck/:id/stats` | Deck analytics |
| `/review` | Cross-deck Today's Review |
| `/settings` | Theme, timer default, card density, sound |
| `/share/:shareId` | Public read-only deck |

## Keyboard shortcuts (in a session)

| Key | Action |
| --- | --- |
| `Space` | Flip card |
| `1` / `2` / `3` / `4` | Grade Again / Hard / Good / Easy |
| `S` | Skip (no grade, re-queues the card) |
| `F` | Focus mode |
| `?` | Shortcuts overlay |

## Notes

- SM-2: Again resets the card (due in 10 minutes), Hard/Good/Easy grow the interval by the ease factor (≥1.3). Mastery threshold: interval > 21 days.
- Grading persists immediately — closing the browser mid-session loses nothing; the session is marked abandoned/complete when you return or finish.
- Scanned/image-only PDFs are detected and rejected with a friendly error (no OCR in v1).
- All card generation happens server-side; AI keys never reach the browser.
