import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import { ankiHtmlToText, clozeToCards, exportApkg, importApkg } from "../src/lib/anki";
import { readZip, writeZip } from "../src/lib/zip";

test("HTML fields become plain text", () => {
  assert.equal(ankiHtmlToText("A&nbsp;<b>bold</b><br>line [sound:x.mp3]<img src='a.png'> &amp; &lt;tag&gt;"), "A bold\nline [image] & <tag>");
});

test("cloze notes become one fill-blank card per cloze", () => {
  const cards = clozeToCards("{{c1::Mitochondria}} make {{c2::ATP::energy}}.", "", "Bio");
  assert.equal(cards.length, 2);
  assert.equal(cards[0].front, "___ make ATP.");
  assert.equal(cards[0].back, "Mitochondria");
  assert.equal(cards[1].front, "Mitochondria make ___ (energy).");
  assert.equal(cards[1].type, "fill-blank");
});

test("export → import round trip", () => {
  const apkg = exportApkg("Cell Biology", [
    { front: "What makes ATP?", back: "Mitochondria", type: "short-answer", options: null, category: "Energy" },
    { front: "Which is a lipid?", back: "Cholesterol", type: "mc", options: ["Glucose", "Cholesterol", "Keratin", "DNA"], category: "Membranes" },
    { front: "A < B & C", back: "line1\nline2", type: "definition", options: null, category: "Misc" },
  ]);
  const zip = readZip(apkg);
  assert.ok(zip.has("collection.anki2") && zip.has("media"));
  const deck = importApkg(apkg, "fallback");
  assert.equal(deck.name, "Cell Biology");
  assert.equal(deck.cards.length, 3);
  assert.equal(deck.cards[0].front, "What makes ATP?");
  assert.equal(deck.cards[0].back, "Mitochondria");
  assert.match(deck.cards[1].front, /A\. Glucose\nB\. Cholesterol/);
  assert.equal(deck.cards[2].front, "A < B & C");
  assert.equal(deck.cards[2].back, "line1\nline2");
  assert.equal(deck.cards[0].category, "Cell Biology");
});

test("imports newer zstd-compressed collections (anki21b)", { skip: typeof zlib.zstdCompressSync !== "function" }, () => {
  // Build a minimal schema-18 style collection: notes/cards/notetypes/decks tables, no col JSON.
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
  const tmp = path.join(os.tmpdir(), `anki21b-${Date.now()}.db`);
  const db = new DatabaseSync(tmp);
  db.exec(`CREATE TABLE notes (id integer primary key, guid text, mid integer, mod integer, usn integer, tags text, flds text, sfld text, csum integer, flags integer, data text);
    CREATE TABLE cards (id integer primary key, nid integer, did integer, ord integer);
    CREATE TABLE notetypes (id integer primary key, name text, config blob);
    CREATE TABLE decks (id integer primary key, name text);`);
  db.prepare("INSERT INTO notetypes VALUES (1, 'Basic', ?)").run(Buffer.from([0x08, 0x00]));
  db.prepare("INSERT INTO notetypes VALUES (2, 'Cloze', ?)").run(Buffer.from([0x08, 0x01]));
  db.prepare("INSERT INTO decks VALUES (5, ?)").run("Languages\x1fSpanish");
  db.prepare("INSERT INTO notes VALUES (1,'g',1,0,0,'',?, 'hola',0,0,'')").run("hola\x1fhello");
  db.prepare("INSERT INTO notes VALUES (2,'h',2,0,0,'',?, 'x',0,0,'')").run("{{c1::Madrid}} is the capital\x1f");
  db.exec("INSERT INTO cards VALUES (10,1,5,0); INSERT INTO cards VALUES (11,2,5,0);");
  db.close();
  const apkg = writeZip([
    { name: "collection.anki2", data: Buffer.from("stub") },
    { name: "collection.anki21b", data: zlib.zstdCompressSync(fs.readFileSync(tmp)) },
  ]);
  fs.rmSync(tmp);
  const deck = importApkg(apkg, "x");
  assert.equal(deck.name, "Spanish");
  assert.deepEqual(deck.cards.map((c) => [c.front, c.back, c.type]), [
    ["hola", "hello", "definition"],
    ["___ is the capital", "Madrid", "fill-blank"],
  ]);
});
