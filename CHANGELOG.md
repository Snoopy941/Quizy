# Changelog

## 1.2.1

**Continue with Google.** Sign in or create your account with Google instead of a password. Your decks still stay on your computer: Google only confirms who you are. Accounts with the same email are linked automatically, and you can add a password later in Settings.

**Safer updating.** Quizy 1.0 and 1.1 let you choose where to install, and updating removed that whole folder. If Quizy had been installed into a folder that also held your own files, updating could delete them. From 1.2.1:
- You can choose where to install (another drive, say). Quizy always gets its own folder there: choosing `D:\Apps` installs into `D:\Apps\Quizy`.
- If an older version was installed somewhere else, the update leaves that folder alone instead of uninstalling there. You can delete the old Quizy files from it yourself.
- Uninstalling only removes Quizy's own files.

**Quizy AI: free, fast and built in.** Quizy no longer runs an AI model on your computer. Making cards, explanations, chat and voice answers now use Quizy AI, a free online service, so there's nothing to download or set up and cards are written in seconds instead of minutes. You can still use your own API key (Groq, Gemini, OpenAI, OpenRouter or Ollama) in Settings. The installer is now one ~140 MB file, and updating removes the old 2 GB AI model.

**A fresh look.** The app now matches quizy.study: black and white, new rounded fonts (built in, so they work offline), simple line icons instead of emoji, and smooth animations when pages open, cards are dealt, and you finish a session.

## 1.2.0

Quizy 1.2 is the biggest update yet. Since 1.0, Quizy has gained a fully offline AI, support for more file types and smarter studying.

**Make cards from anything**
- PDF, Word, PowerPoint, text and Markdown files, pasted notes and photos of notes (read offline with OCR)
- The AI runs on your PC, so no API key and no internet are needed
- Every card links back to the page it came from, with the passage highlighted
- The main figure from each page is attached to its cards automatically
- Make cards in another language, with OCR for 20 languages

**Study smarter**
- Answer by tapping multiple choice, typing or speaking, and Quizy checks your answer
- Hear questions read aloud
- "Explain this" walks you through any card
- Weak-spot review drills the cards you miss most, and "More like this" adds new cards on a topic
- Better scheduling (FSRS) for spaced repetition

**Ask your notes**
- Chat with your document and get answers with page references
- A cheat sheet summarises each section
- The card quality check flags vague or duplicate cards and suggests fixes

**Study anywhere**
- Scan a QR code to study on your phone over Wi-Fi while Quizy is open on your PC
- Import and export Anki decks

**Under the hood**
- Automatic updates from now on
- Sign-in rate limiting, a real sign-out and offline password recovery codes
- Quizy now picks a free port if its usual one is busy
- Quizy always installs into its own folder, so installing or uninstalling it can't touch your other files

**Downloads**
- `Quizy-Setup-1.2.0-lite.exe` (about 150 MB): downloads the AI model on first launch
- `Quizy-Setup-1.2.0.exe` (about 1.9 GB): everything included, for installing offline

**Upgrading from 1.0?** 1.0 can't update itself, so download and install 1.2 once. Later versions will update automatically.

Windows may show an "unknown publisher" warning because the app isn't code-signed yet. Click **More info → Run anyway**.
