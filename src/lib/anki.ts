/**
 * Anki deck import (.apkg / .colpkg) and export (.apkg).
 *
 * An .apkg is a zip holding an SQLite collection. Newer Anki writes
 * `collection.anki21b` (zstd-compressed, schema 18) alongside a stub
 * `collection.anki2`; older versions write `collection.anki21` or
 * `collection.anki2` (schema 11). All carry notes in the `notes` table with
 * fields separated by \x1f, which is all we need.
 *
 * Export writes the classic schema-11 `collection.anki2`, which every Anki
 * version (desktop, AnkiMobile, AnkiDroid) can import.
 *
 * Uses Node's built-in SQLite (node:sqlite, Node ≥ 22.5) and zstd
 * (Node ≥ 22.15) — loaded via process.getBuiltinModule so the bundler
 * leaves them alone.
 */
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { readZip, writeZip } from "./zip";
import type { CardType } from "./card-parse";

type SqliteModule = typeof import("node:sqlite");

function sqlite(): SqliteModule {
  const mod = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule?.("node:sqlite");
  if (!mod) throw new Error("Anki import/export needs Node.js 22.5 or newer.");
  return mod as SqliteModule;
}

export interface ImportedCard {
  front: string;
  back: string;
  type: CardType;
  category: string;
}

export interface ImportedDeck {
  name: string;
  cards: ImportedCard[];
  skipped: number;
}

/** Anki field HTML → plain text. */
export function ankiHtmlToText(html: string): string {
  return html
    .replace(/\[sound:[^\]]*\]/g, "")
    .replace(/<img\b[^>]*>/gi, " [image] ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li|tr|h\d)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const CLOZE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

/** One cloze note → one fill-in-the-blank card per cloze number. */
export function clozeToCards(text: string, extra: string, category: string): ImportedCard[] {
  const nums = [...new Set([...text.matchAll(CLOZE)].map((m) => m[1]))];
  return nums.map((n) => {
    const answers: string[] = [];
    const front = text.replace(CLOZE, (_all, num: string, answer: string, hint?: string) => {
      if (num === n) {
        answers.push(answer);
        return hint ? `___ (${hint})` : "___";
      }
      return answer;
    });
    return {
      front: front.trim(),
      back: answers.join(" · ") + (extra ? `\n\n${extra}` : ""),
      type: "fill-blank" as const,
      category,
    };
  });
}

function decompress(buf: Buffer): Buffer {
  const zlib = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule?.("zlib") as
    | { zstdDecompressSync?: (b: Buffer) => Buffer }
    | undefined;
  if (!zlib?.zstdDecompressSync) {
    throw new Error(
      "This deck was exported by a newer Anki. Re-export it with “Support older Anki versions” ticked, then import again."
    );
  }
  return zlib.zstdDecompressSync(buf);
}

/** Parse an .apkg/.colpkg file into plain cards (scheduling history is not imported). */
export function importApkg(buf: Buffer, fallbackName: string): ImportedDeck {
  const zip = readZip(buf);
  let db: Buffer | null = null;
  if (zip.has("collection.anki21b")) db = decompress(zip.get("collection.anki21b")!.read());
  else if (zip.has("collection.anki21")) db = zip.get("collection.anki21")!.read();
  else if (zip.has("collection.anki2")) db = zip.get("collection.anki2")!.read();
  if (!db) throw new Error("No Anki collection found in this file.");

  const tmp = path.join(os.tmpdir(), `quizy-anki-${crypto.randomUUID()}.db`);
  fs.writeFileSync(tmp, db);
  const { DatabaseSync } = sqlite();
  const conn = new DatabaseSync(tmp, { readOnly: true });
  try {
    const tables = new Set(
      (conn.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name)
    );
    // Note type kind (0 = standard, 1 = cloze) and deck names
    const clozeModels = new Set<string>();
    const deckNames = new Map<string, string>();
    if (tables.has("notetypes")) {
      for (const r of conn.prepare("SELECT id, name, config FROM notetypes").all() as { id: number | bigint; name: string; config: Uint8Array }[]) {
        // NotetypeConfig protobuf: field 1 (kind) varint; cloze = 1 → bytes 0x08 0x01
        const cfg = Buffer.from(r.config ?? []);
        if ((cfg[0] === 0x08 && cfg[1] === 0x01) || /cloze/i.test(r.name)) clozeModels.add(String(r.id));
      }
    }
    if (tables.has("decks") && !tables.has("col")) {
      for (const r of conn.prepare("SELECT id, name FROM decks").all() as { id: number | bigint; name: string }[]) {
        deckNames.set(String(r.id), r.name.replace(/\x1f/g, "::"));
      }
    }
    if (tables.has("col")) {
      const col = conn.prepare("SELECT models, decks FROM col").get() as { models: string; decks: string } | undefined;
      try {
        const models = JSON.parse(col?.models || "{}") as Record<string, { type?: number }>;
        for (const [id, m] of Object.entries(models)) if (m.type === 1) clozeModels.add(id);
      } catch {}
      try {
        const decks = JSON.parse(col?.decks || "{}") as Record<string, { name?: string }>;
        for (const [id, d] of Object.entries(decks)) if (d.name) deckNames.set(id, d.name);
      } catch {}
      if (tables.has("decks")) {
        for (const r of conn.prepare("SELECT id, name FROM decks").all() as { id: number | bigint; name: string }[]) {
          deckNames.set(String(r.id), r.name.replace(/\x1f/g, "::"));
        }
      }
    }

    // Deck each note lives in (first card's deck)
    const noteDeck = new Map<string, string>();
    for (const r of conn.prepare("SELECT nid, did FROM cards ORDER BY ord").all() as { nid: number | bigint; did: number | bigint }[]) {
      const k = String(r.nid);
      if (!noteDeck.has(k)) noteDeck.set(k, String(r.did));
    }

    const cards: ImportedCard[] = [];
    let skipped = 0;
    const usedDecks = new Map<string, number>();
    for (const n of conn.prepare("SELECT id, mid, flds, tags FROM notes ORDER BY id").all() as {
      id: number | bigint;
      mid: number | bigint;
      flds: string;
      tags: string;
    }[]) {
      const fields = n.flds.split("\x1f");
      const deckName = deckNames.get(noteDeck.get(String(n.id)) ?? "") ?? "";
      const category = (deckName.split("::").pop() || "Imported").slice(0, 80);
      const isCloze = clozeModels.has(String(n.mid)) || CLOZE.test(fields[0] ?? "");
      CLOZE.lastIndex = 0;
      if (isCloze) {
        const made = clozeToCards(ankiHtmlToText(fields[0] ?? ""), ankiHtmlToText(fields[1] ?? ""), category);
        if (!made.length) skipped++;
        cards.push(...made);
      } else {
        const front = ankiHtmlToText(fields[0] ?? "");
        const back = ankiHtmlToText(fields.slice(1).filter((f) => f.trim()).join("\n\n"));
        if (!front || !back) {
          skipped++;
          continue;
        }
        cards.push({ front: front.slice(0, 2000), back: back.slice(0, 4000), type: "definition", category });
      }
      if (deckName) usedDecks.set(deckName, (usedDecks.get(deckName) ?? 0) + 1);
    }
    // Ignore the "please update Anki" stub some exports contain
    const realCards = cards.filter((c) => !/please update to the latest anki version/i.test(c.front));
    const top = [...usedDecks.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const name = top && top !== "Default" ? top.split("::").pop()! : fallbackName;
    return { name: name.slice(0, 120), cards: realCards, skipped: skipped + (cards.length - realCards.length) };
  } finally {
    conn.close();
    fs.rmSync(tmp, { force: true });
  }
}

/* ---------------- export ---------------- */

export interface ExportCard {
  front: string;
  back: string;
  type: string;
  options: string[] | null;
  category: string;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");

function guid(): string {
  // Anki uses base91 guids; any unique printable string works.
  return crypto.randomBytes(8).toString("base64").replace(/[+/=]/g, (c) => ({ "+": "x", "/": "y", "=": "" })[c] ?? "");
}

function fieldChecksum(s: string): number {
  return parseInt(crypto.createHash("sha1").update(s, "utf8").digest("hex").slice(0, 8), 16);
}

const SCHEMA_11 = `
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
`;

/** Build an .apkg (schema 11) containing one deck of Basic notes. */
export function exportApkg(deckName: string, cards: ExportCard[]): Buffer {
  const now = Date.now();
  const nowSec = Math.floor(now / 1000);
  const deckId = now;
  const modelId = now + 1;

  const model = {
    id: modelId,
    name: "Quizy Basic",
    type: 0,
    mod: nowSec,
    usn: -1,
    sortf: 0,
    did: deckId,
    tmpls: [
      {
        name: "Card 1",
        ord: 0,
        qfmt: "{{Front}}",
        afmt: "{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}",
        did: null,
        bqfmt: "",
        bafmt: "",
      },
    ],
    flds: [
      { name: "Front", ord: 0, sticky: false, rtl: false, font: "Arial", size: 20, media: [] },
      { name: "Back", ord: 1, sticky: false, rtl: false, font: "Arial", size: 20, media: [] },
    ],
    css: ".card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }\n.options { text-align: left; display: inline-block; }",
    latexPre:
      "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n",
    latexPost: "\\end{document}",
    tags: [],
    vers: [],
    req: [[0, "any", [0]]],
  };
  const deck = (id: number, name: string) => ({
    id,
    name,
    mod: nowSec,
    usn: -1,
    lrnToday: [0, 0],
    revToday: [0, 0],
    newToday: [0, 0],
    timeToday: [0, 0],
    collapsed: false,
    desc: "Exported from Quizy",
    dyn: 0,
    conf: 1,
    extendNew: 10,
    extendRev: 50,
  });
  const decks = { "1": deck(1, "Default"), [String(deckId)]: deck(deckId, deckName || "Quizy deck") };
  const dconf = {
    "1": {
      id: 1,
      name: "Default",
      mod: 0,
      usn: 0,
      maxTaken: 60,
      autoplay: true,
      timer: 0,
      replayq: true,
      dyn: false,
      new: { delays: [1, 10], ints: [1, 4, 7], initialFactor: 2500, order: 1, perDay: 20, bury: true, separate: true },
      lapse: { delays: [10], mult: 0, minInt: 1, leechFails: 8, leechAction: 0 },
      rev: { perDay: 200, ease4: 1.3, fuzz: 0.05, maxIvl: 36500, ivlFct: 1, bury: true, minSpace: 1 },
    },
  };
  const conf = {
    activeDecks: [1],
    curDeck: 1,
    newSpread: 0,
    collapseTime: 1200,
    timeLim: 0,
    estTimes: true,
    dueCounts: true,
    curModel: String(modelId),
    nextPos: cards.length + 1,
    sortType: "noteFld",
    sortBackwards: false,
    addToCur: true,
  };

  const tmp = path.join(os.tmpdir(), `quizy-export-${crypto.randomUUID()}.anki2`);
  const { DatabaseSync } = sqlite();
  const db = new DatabaseSync(tmp);
  try {
    db.exec(SCHEMA_11);
    db.prepare(
      "INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, '{}')"
    ).run(nowSec, now, now, JSON.stringify(conf), JSON.stringify({ [String(modelId)]: model }), JSON.stringify(decks), JSON.stringify(dconf));
    const insNote = db.prepare("INSERT INTO notes VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, '')");
    const insCard = db.prepare("INSERT INTO cards VALUES (?, ?, ?, 0, ?, -1, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, '')");
    db.exec("BEGIN");
    cards.forEach((c, i) => {
      let front = esc(c.front);
      if (c.type === "mc" && c.options?.length) {
        front += `<br><br><div class="options">${c.options.map((o, k) => `${"ABCD"[k]}. ${esc(o)}`).join("<br>")}</div>`;
      } else if (c.type === "true-false") {
        front += "<br><br><i>True or false?</i>";
      }
      const back = esc(c.back);
      const noteId = now + 10 + i;
      const tags = c.category ? ` ${c.category.replace(/\s+/g, "_")} ` : "";
      insNote.run(noteId, guid(), modelId, nowSec, tags, `${front}\x1f${back}`, c.front, fieldChecksum(c.front));
      insCard.run(now + 100000 + i, noteId, deckId, nowSec, i + 1);
    });
    db.exec("COMMIT");
  } finally {
    db.close();
  }
  const data = fs.readFileSync(tmp);
  fs.rmSync(tmp, { force: true });
  return writeZip([
    { name: "collection.anki2", data },
    { name: "media", data: Buffer.from("{}") },
  ]);
}
