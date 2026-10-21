# Quizy — quizy.study

**AI-powered study companion.** Add a PDF, Word document, PowerPoint, photo of your notes, or pasted text — Quizy extracts the text, writes flashcards with AI (free and built in: no API key needed), and schedules them with spaced repetition (FSRS).

Monochrome black-and-white design, dark mode by default with a light toggle.

## Features

- **Any study material → flashcards**: PDF, Word (.docx), PowerPoint (.pptx, incl. speaker notes), text/Markdown, pasted notes, and images or scanned PDFs (offline OCR) — drag-and-drop up to 50MB
- **Quizy AI, free with no setup**: the app ships with a shared [Groq](https://groq.com) key (GPT-OSS 120B, falling back to GPT-OSS 20B and Qwen when one is rate-limited). Anyone can use their own key instead, for any OpenAI-compatible endpoint (Groq, Gemini, OpenAI, OpenRouter, Ollama…) in **Settings → AI**
- **Card quality**: page/slide numbers on every card with a “Source” panel highlighting the supporting quote, JSON-schema-constrained output, validation/repair of malformed cards, near-duplicate removal, context-aware heading detection, sections generated in parallel, interrupted jobs resume on restart
- **No silent fallback**: if the AI isn't set up or fails, you get a clear message — never placeholder cards
- **5 card types**: definition, fill-in-the-blank, multiple choice, true/false, short answer
- **AI controls**: card density (low/medium/high), per-deck custom instructions, per-card and per-section regeneration, full re-generate from PDF
- **Study sessions**: clickable multiple-choice / true-false, typed answers for fill-in-the-blank (typo-tolerant) and short answers (AI judges meaning), “Explain this” AI tutor with follow-up questions, 3D card flip, keyboard shortcuts (Space flip, 1–4 answer/grade, Enter accept suggested grade, E explain, S skip, F focus, ? help)
- **Spaced repetition (FSRS-5)**: stability/difficulty memory model, interval previews on the grade buttons, old SM-2 cards converted automatically; mastery = interval > 21 days
- **Anki**: import .apkg/.colpkg decks (incl. cloze notes and newer zstd-compressed collections), export any deck to .apkg
- **Timed review**: 5/10/15/30/60-minute countdown, cycles due cards then recycles the queue, session summary with weakest categories
- **Cross-deck "Today's Review"** queue at `/review`
- **Analytics**: per-deck stats, 30-day activity chart, mastery by category, session history, daily streak
- **Deck management**: rename, duplicate, pin, delete, CSV/JSON/Anki export, public share links
- **Auth**: email + password (bcrypt + JWT httpOnly cookie sessions), sign-in rate limiting, real sign-out (invalidates every session), change password, offline password reset with a one-time **recovery code** (no email needed)
- **AI study tools**: **Ask your document** (chat with page citations), **cheat sheet** summaries per section (printable), **card quality check** (flags vague/duplicate/give-away cards and suggests rewrites), **More like this** (3 new cards on a concept you keep missing), **Weak spots** review of your most-missed cards
- **Images on cards**: the main figure from each PDF page / slide is attached to its cards automatically; add or change a card image yourself
- **Voice**: read questions/answers aloud (Windows voices, offline) and answer by speaking (Whisper on Groq)
- **Languages**: write cards in another language than the source, OCR for 20 languages (downloaded on demand)
- **Desktop app**: automatic updates from GitHub Releases, one ~140 MB installer, free-port fallback, **study on your phone** over Wi-Fi (QR pairing)
- **Polish**: dark/light theme, sound effects toggle, confetti on session completion, 50-correct easter egg, onboarding checklist, empty states, mobile bottom tabs, resume after closing the tab mid-session

## Quick start (local)

```bash
npm install
npx prisma generate         # re-run after pulling schema changes
npx prisma migrate deploy   # creates data/quizy.db (the server also applies migrations on start)
npm run dev                 # http://localhost:4000
```

Pick the AI in **Settings → AI**:

- **API key** — paste an OpenAI/OpenRouter key, or point it at a local [Ollama](https://ollama.com) (`http://localhost:11434/v1`, model e.g. `qwen3:4b`, no key).
- **Quizy AI** — put a Groq API key in `ai-key.txt` at the repo root (or set `QUIZY_AI_KEY`). The file is gitignored and the installer build copies it into the app. Every copy of Quizy shares that key's free limits.
- `MOCK_AI=1` enables a deterministic demo generator **only when nothing else is set up** — decks made with it are labelled.

Env defaults still work for servers/Docker: `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`.

Run the tests with `npm test` (FSRS, card parsing/dedup, chunking + page mapping, Word/PowerPoint extraction, Anki round-trip, migrations).

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
- AI: Quizy AI works out of the box (needs internet); to use your own key instead, open **Settings → AI**

## Windows installer (for distribution)

Build the real installer — license screen, desktop + Start Menu shortcuts, launch-on-finish, uninstaller:

```bash
bash scripts/build-installer.sh
# → installer-out/Quizy-Setup-<version>.exe  (~140 MB) + .blockmap + latest.yml for updates
```

The first build downloads Tesseract's English OCR model (cached in `installer/cache/`). Put the Quizy AI key in `ai-key.txt` first, or the app will ask users for their own key.

What installers get: per-user install to `%LOCALAPPDATA%\Programs\Quizy`, a first-run seed (demo account `demo@quizy.study` / `password123` + sample PDFs), user data in `%APPDATA%\Quizy` that survives updates and uninstall, full version/copyright metadata, and the branded icon on every binary.

To distribute: host `Quizy-Setup-<version>.exe` (e.g. `https://quizy.study/downloads/Quizy-Setup.exe`) and link it from the site. Note: the exe is **unsigned**, so Windows SmartScreen will show "unknown publisher" — buyers of a code-signing certificate can drop the cert into `installer/` and set `CSC_LINK`/`CSC_KEY_PASSWORD` to sign automatically.

### Publishing an update

Installed copies check `github.com/Snoopy941/Quizy` releases every few hours and update themselves (only changed blocks are downloaded).

1. Bump `"version"` in `installer/package.json` and `package.json`.
2. Double-click `build.bat` (or `bash scripts/build-installer.sh`).
3. `bash scripts/publish-release.sh "What's new"` — needs the [GitHub CLI](https://cli.github.com) (`gh auth login` once). The repository must be **public** for users' copies to download updates.

The release carries the installer, its `.blockmap` and `latest.yml` (what installed copies check for updates).

### Code signing

Unsigned builds show Windows' "unknown publisher" warning. With a code-signing certificate (`.pfx`), set these before building and electron-builder signs every exe automatically:

```bash
export CSC_LINK=/d/certs/quizy.pfx      # or a base64 string / https URL
export CSC_KEY_PASSWORD='…'
bash scripts/build-installer.sh
```

### Continue with Google

Optional. Accounts still live on the user's computer; Google only confirms who they are.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project, then go to **APIs & Services → OAuth consent screen** and set it up (External, app name "Quizy", your email, scopes `openid`, `email`, `profile`). Publish the app so anyone can sign in.
2. Go to **Credentials → Create credentials → OAuth client ID**, choose **Desktop app**, and download the JSON.
3. Save it as `google-oauth.json` in the project root. It's git-ignored, and the installer build copies it into the app.

For development you can set `QUIZY_GOOGLE_CLIENT_ID` and `QUIZY_GOOGLE_CLIENT_SECRET` instead. Sign-in opens in the system browser and returns to `http://127.0.0.1:<port>/api/auth/google/callback`. Google allows any loopback port for Desktop app clients, so nothing needs registering.

### Study on your phone

Settings → **Study on your phone** shares Quizy on your Wi-Fi while the desktop app is open: scan the QR code, sign in, study. Only devices that scanned the code can connect (a long random pairing cookie); "Disconnect all phones" revokes them. Windows asks once whether to allow Quizy on networks — choose *Private networks*.

### UI tests

`npm run test:ui` (or double-click `ui-test.bat`) runs click-through Playwright tests against a throwaway dev server using the demo generator — sign-up, creating a deck, studying, password reset, rate limiting, deck tools and a phone-sized layout. First run: `npx playwright install chromium`.

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
| `/library/new` | Upload a file / paste text / import Anki → new deck |
| `/deck/:id` | Deck detail: card list, edit/reorder/regenerate, study |
| `/deck/:id/study` | Flashcard session (`?timed=10` for timed mode) |
| `/deck/:id/stats` | Deck analytics |
| `/review` | Cross-deck Today's Review |
| `/settings` | AI provider, theme, timer default, card density, sound |
| `/share/:shareId` | Public read-only deck |

## Keyboard shortcuts (in a session)

| Key | Action |
| --- | --- |
| `Space` | Flip card / show answer |
| `1`–`4` (before flipping) | Pick a multiple-choice option (`1` True / `2` False) |
| `Enter` | Check a typed answer, then accept the suggested grade |
| `1` / `2` / `3` / `4` | Grade Again / Hard / Good / Easy |
| `E` | Explain this card |
| `S` | Skip (no grade, re-queues the card) |
| `F` | Focus mode |
| `?` | Shortcuts overlay |

## Notes

- FSRS-5 with default weights and 90% target retention: new cards go through 1/5/10-minute steps, lapses relearn in 10 minutes. Cards reviewed under the old SM-2 scheduler are converted on their next review. Mastery threshold: interval > 21 days.
- Database migrations are applied by the server on startup (`src/lib/migrate.ts`, recorded in `_prisma_migrations` like Prisma does), so installed desktop copies upgrade themselves.
- Grading persists immediately — closing the browser mid-session loses nothing; the session is marked abandoned/complete when you return or finish.
- Scanned/image-only PDFs and photos are read with offline OCR (tesseract.js, English).
- All card generation happens server-side; AI keys never reach the browser.
