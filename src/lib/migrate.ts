/**
 * Runtime database migrations.
 *
 * The desktop build ships without the Prisma CLI, so `prisma migrate deploy`
 * can't run on users' machines. This applies the same migration files at
 * server start and records them in `_prisma_migrations` exactly like Prisma
 * does (same checksum = sha256 of the file), so dev machines that later run
 * `prisma migrate deploy` see them as already applied.
 *
 * Keep MIGRATIONS byte-identical to prisma/migrations/<name>/migration.sql —
 * tests/migrations.test.ts enforces this.
 */
import crypto from "crypto";
import { prisma } from "@/lib/db";

export const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: "20260921045204_init",
    sql: "-- CreateTable\nCREATE TABLE \"User\" (\n    \"id\" TEXT NOT NULL PRIMARY KEY,\n    \"email\" TEXT NOT NULL,\n    \"passwordHash\" TEXT NOT NULL,\n    \"name\" TEXT NOT NULL DEFAULT '',\n    \"avatar\" TEXT,\n    \"createdAt\" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP\n);\n\n-- CreateTable\nCREATE TABLE \"Deck\" (\n    \"id\" TEXT NOT NULL PRIMARY KEY,\n    \"userId\" TEXT NOT NULL,\n    \"name\" TEXT NOT NULL,\n    \"description\" TEXT NOT NULL DEFAULT '',\n    \"pdfUrl\" TEXT,\n    \"instructions\" TEXT NOT NULL DEFAULT '',\n    \"density\" TEXT NOT NULL DEFAULT 'medium',\n    \"pinned\" BOOLEAN NOT NULL DEFAULT false,\n    \"shareId\" TEXT,\n    \"genStatus\" TEXT NOT NULL DEFAULT 'idle',\n    \"genProgress\" INTEGER NOT NULL DEFAULT 0,\n    \"genError\" TEXT,\n    \"lastStudiedAt\" DATETIME,\n    \"createdAt\" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,\n    \"updatedAt\" DATETIME NOT NULL,\n    CONSTRAINT \"Deck_userId_fkey\" FOREIGN KEY (\"userId\") REFERENCES \"User\" (\"id\") ON DELETE CASCADE ON UPDATE CASCADE\n);\n\n-- CreateTable\nCREATE TABLE \"DeckChunk\" (\n    \"id\" TEXT NOT NULL PRIMARY KEY,\n    \"deckId\" TEXT NOT NULL,\n    \"position\" INTEGER NOT NULL,\n    \"heading\" TEXT NOT NULL DEFAULT '',\n    \"text\" TEXT NOT NULL,\n    \"status\" TEXT NOT NULL DEFAULT 'pending',\n    \"cardCount\" INTEGER NOT NULL DEFAULT 4,\n    CONSTRAINT \"DeckChunk_deckId_fkey\" FOREIGN KEY (\"deckId\") REFERENCES \"Deck\" (\"id\") ON DELETE CASCADE ON UPDATE CASCADE\n);\n\n-- CreateTable\nCREATE TABLE \"Card\" (\n    \"id\" TEXT NOT NULL PRIMARY KEY,\n    \"deckId\" TEXT NOT NULL,\n    \"chunkId\" TEXT,\n    \"front\" TEXT NOT NULL,\n    \"back\" TEXT NOT NULL,\n    \"type\" TEXT NOT NULL DEFAULT 'definition',\n    \"options\" TEXT,\n    \"difficulty\" TEXT NOT NULL DEFAULT 'medium',\n    \"category\" TEXT NOT NULL DEFAULT 'General',\n    \"position\" INTEGER NOT NULL DEFAULT 0,\n    \"easeFactor\" REAL NOT NULL DEFAULT 2.5,\n    \"intervalDays\" REAL NOT NULL DEFAULT 0,\n    \"dueDate\" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,\n    \"reps\" INTEGER NOT NULL DEFAULT 0,\n    \"lapses\" INTEGER NOT NULL DEFAULT 0,\n    \"timesSeen\" INTEGER NOT NULL DEFAULT 0,\n    \"timesFailed\" INTEGER NOT NULL DEFAULT 0,\n    \"createdAt\" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,\n    CONSTRAINT \"Card_deckId_fkey\" FOREIGN KEY (\"deckId\") REFERENCES \"Deck\" (\"id\") ON DELETE CASCADE ON UPDATE CASCADE,\n    CONSTRAINT \"Card_chunkId_fkey\" FOREIGN KEY (\"chunkId\") REFERENCES \"DeckChunk\" (\"id\") ON DELETE SET NULL ON UPDATE CASCADE\n);\n\n-- CreateTable\nCREATE TABLE \"StudySession\" (\n    \"id\" TEXT NOT NULL PRIMARY KEY,\n    \"userId\" TEXT NOT NULL,\n    \"deckId\" TEXT,\n    \"mode\" TEXT NOT NULL DEFAULT 'normal',\n    \"timerMinutes\" INTEGER,\n    \"status\" TEXT NOT NULL DEFAULT 'active',\n    \"startedAt\" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,\n    \"endedAt\" DATETIME,\n    \"cardsReviewed\" INTEGER NOT NULL DEFAULT 0,\n    \"correctCount\" INTEGER NOT NULL DEFAULT 0,\n    \"timeSpentSeconds\" INTEGER NOT NULL DEFAULT 0,\n    CONSTRAINT \"StudySession_userId_fkey\" FOREIGN KEY (\"userId\") REFERENCES \"User\" (\"id\") ON DELETE CASCADE ON UPDATE CASCADE,\n    CONSTRAINT \"StudySession_deckId_fkey\" FOREIGN KEY (\"deckId\") REFERENCES \"Deck\" (\"id\") ON DELETE SET NULL ON UPDATE CASCADE\n);\n\n-- CreateTable\nCREATE TABLE \"SessionCard\" (\n    \"id\" TEXT NOT NULL PRIMARY KEY,\n    \"sessionId\" TEXT NOT NULL,\n    \"cardId\" TEXT,\n    \"grade\" TEXT NOT NULL,\n    \"timeSpentSeconds\" INTEGER NOT NULL DEFAULT 0,\n    \"correct\" BOOLEAN NOT NULL DEFAULT false,\n    \"reviewedAt\" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,\n    CONSTRAINT \"SessionCard_sessionId_fkey\" FOREIGN KEY (\"sessionId\") REFERENCES \"StudySession\" (\"id\") ON DELETE CASCADE ON UPDATE CASCADE,\n    CONSTRAINT \"SessionCard_cardId_fkey\" FOREIGN KEY (\"cardId\") REFERENCES \"Card\" (\"id\") ON DELETE SET NULL ON UPDATE CASCADE\n);\n\n-- CreateTable\nCREATE TABLE \"UserSettings\" (\n    \"id\" TEXT NOT NULL PRIMARY KEY,\n    \"userId\" TEXT NOT NULL,\n    \"theme\" TEXT NOT NULL DEFAULT 'dark',\n    \"defaultTimerMinutes\" INTEGER NOT NULL DEFAULT 10,\n    \"cardDensity\" TEXT NOT NULL DEFAULT 'medium',\n    \"soundEnabled\" BOOLEAN NOT NULL DEFAULT true,\n    CONSTRAINT \"UserSettings_userId_fkey\" FOREIGN KEY (\"userId\") REFERENCES \"User\" (\"id\") ON DELETE CASCADE ON UPDATE CASCADE\n);\n\n-- CreateIndex\nCREATE UNIQUE INDEX \"User_email_key\" ON \"User\"(\"email\");\n\n-- CreateIndex\nCREATE UNIQUE INDEX \"Deck_shareId_key\" ON \"Deck\"(\"shareId\");\n\n-- CreateIndex\nCREATE INDEX \"Deck_userId_idx\" ON \"Deck\"(\"userId\");\n\n-- CreateIndex\nCREATE INDEX \"DeckChunk_deckId_idx\" ON \"DeckChunk\"(\"deckId\");\n\n-- CreateIndex\nCREATE INDEX \"Card_deckId_idx\" ON \"Card\"(\"deckId\");\n\n-- CreateIndex\nCREATE INDEX \"Card_dueDate_idx\" ON \"Card\"(\"dueDate\");\n\n-- CreateIndex\nCREATE INDEX \"StudySession_userId_idx\" ON \"StudySession\"(\"userId\");\n\n-- CreateIndex\nCREATE INDEX \"StudySession_deckId_idx\" ON \"StudySession\"(\"deckId\");\n\n-- CreateIndex\nCREATE INDEX \"SessionCard_sessionId_idx\" ON \"SessionCard\"(\"sessionId\");\n\n-- CreateIndex\nCREATE UNIQUE INDEX \"UserSettings_userId_key\" ON \"UserSettings\"(\"userId\");\n",
  },
  {
    name: "20261018000000_ai_fsrs_sources",
    sql: "-- AlterTable\nALTER TABLE \"Deck\" ADD COLUMN \"sourceType\" TEXT NOT NULL DEFAULT 'pdf';\nALTER TABLE \"Deck\" ADD COLUMN \"aiSource\" TEXT;\n\n-- AlterTable\nALTER TABLE \"DeckChunk\" ADD COLUMN \"pageStart\" INTEGER;\nALTER TABLE \"DeckChunk\" ADD COLUMN \"pageEnd\" INTEGER;\nALTER TABLE \"DeckChunk\" ADD COLUMN \"pageMap\" TEXT;\n\n-- AlterTable\nALTER TABLE \"Card\" ADD COLUMN \"sourcePage\" INTEGER;\nALTER TABLE \"Card\" ADD COLUMN \"sourceQuote\" TEXT;\nALTER TABLE \"Card\" ADD COLUMN \"stability\" REAL;\nALTER TABLE \"Card\" ADD COLUMN \"fsrsDifficulty\" REAL;\nALTER TABLE \"Card\" ADD COLUMN \"fsrsState\" INTEGER;\nALTER TABLE \"Card\" ADD COLUMN \"lastReviewAt\" DATETIME;\n\n-- AlterTable\nALTER TABLE \"UserSettings\" ADD COLUMN \"aiProvider\" TEXT NOT NULL DEFAULT 'auto';\nALTER TABLE \"UserSettings\" ADD COLUMN \"aiBaseUrl\" TEXT NOT NULL DEFAULT '';\nALTER TABLE \"UserSettings\" ADD COLUMN \"aiApiKey\" TEXT NOT NULL DEFAULT '';\nALTER TABLE \"UserSettings\" ADD COLUMN \"aiModel\" TEXT NOT NULL DEFAULT '';\n",
  },
  {
    name: "20261019000000_v1_2_features",
    sql: "-- AlterTable\nALTER TABLE \"User\" ADD COLUMN \"tokenVersion\" INTEGER NOT NULL DEFAULT 0;\nALTER TABLE \"User\" ADD COLUMN \"recoveryHash\" TEXT;\n\n-- AlterTable\nALTER TABLE \"Deck\" ADD COLUMN \"cardLanguage\" TEXT NOT NULL DEFAULT 'auto';\nALTER TABLE \"Deck\" ADD COLUMN \"ocrLanguage\" TEXT NOT NULL DEFAULT 'eng';\nALTER TABLE \"Deck\" ADD COLUMN \"figures\" TEXT;\n\n-- AlterTable\nALTER TABLE \"DeckChunk\" ADD COLUMN \"summary\" TEXT;\n\n-- AlterTable\nALTER TABLE \"Card\" ADD COLUMN \"imageUrl\" TEXT;\n\n-- AlterTable\nALTER TABLE \"UserSettings\" ADD COLUMN \"readAloud\" BOOLEAN NOT NULL DEFAULT false;\n",
  },
  {
    name: "20261020000000_google_sign_in",
    sql: "-- Sign in with Google: link a local account to a Google account id.\nALTER TABLE \"User\" ADD COLUMN \"googleSub\" TEXT;\n\nCREATE UNIQUE INDEX \"User_googleSub_key\" ON \"User\"(\"googleSub\");\n",
  },
];

/** Split a migration file into single statements (no semicolons inside literals in our files). */
export function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) =>
      s
        .split(/\r?\n/)
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter(Boolean);
}

export function checksum(sql: string): string {
  return crypto.createHash("sha256").update(sql).digest("hex");
}

let done: Promise<void> | null = null;

/** Apply pending migrations once per process. Safe to call repeatedly. */
export function ensureMigrated(): Promise<void> {
  if (!done) {
    done = runMigrations().catch((err) => {
      done = null;
      throw err;
    });
  }
  return done;
}

async function runMigrations() {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                    TEXT PRIMARY KEY NOT NULL,
    "checksum"              TEXT NOT NULL,
    "finished_at"           DATETIME,
    "migration_name"        TEXT NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        DATETIME,
    "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
)`);
  const rows = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
    `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
  );
  const applied = new Set(rows.map((r) => r.migration_name));
  const tables = await prisma.$queryRawUnsafe<{ name: string }[]>(
    `SELECT name FROM sqlite_master WHERE type='table'`
  );
  const tableNames = new Set(tables.map((t) => t.name));

  for (const m of MIGRATIONS) {
    if (applied.has(m.name)) continue;
    // A database created by an old `prisma db push` has the tables but no
    // history row: treat init as applied instead of failing on CREATE TABLE.
    if (m.name.endsWith("_init") && tableNames.has("User")) {
      await record(m, Date.now());
      continue;
    }
    const started = Date.now();
    for (const stmt of splitStatements(m.sql)) {
      try {
        await prisma.$executeRawUnsafe(stmt);
      } catch (err) {
        // Re-running after a crash mid-migration: columns may already exist.
        const msg = err instanceof Error ? err.message : String(err);
        if (/duplicate column name|already exists/i.test(msg)) continue;
        throw err;
      }
    }
    await record(m, started);
    console.log(`[migrate] applied ${m.name}`);
  }
}

async function record(m: { name: string; sql: string }, started: number) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, started_at, applied_steps_count) VALUES (?, ?, ?, ?, ?, 1)`,
    crypto.randomUUID(),
    checksum(m.sql),
    Date.now(),
    m.name,
    started
  );
}
