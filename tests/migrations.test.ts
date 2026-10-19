import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import crypto from "crypto";

// migrate.ts imports the Prisma client; read its MIGRATIONS without importing it.
const src = fs.readFileSync(path.join(process.cwd(), "src/lib/migrate.ts"), "utf8");
const dir = path.join(process.cwd(), "prisma/migrations");

function embedded(): { name: string; sql: string }[] {
  const out: { name: string; sql: string }[] = [];
  for (const m of src.matchAll(/name: ("[^"]+"),\s*sql: ("(?:[^"\\]|\\.)*")/g)) {
    out.push({ name: JSON.parse(m[1]), sql: JSON.parse(m[2]) });
  }
  return out;
}

test("runtime migrations match prisma/migrations exactly (same checksum)", () => {
  const folders = fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory()).sort();
  const emb = embedded();
  assert.deepEqual(emb.map((e) => e.name), folders);
  for (const e of emb) {
    const file = fs.readFileSync(path.join(dir, e.name, "migration.sql"), "utf8");
    assert.equal(crypto.createHash("sha256").update(e.sql).digest("hex"), crypto.createHash("sha256").update(file).digest("hex"), e.name);
  }
});

test("migrations apply cleanly in order on SQLite", () => {
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  for (const e of embedded()) db.exec(e.sql);
  const cols = (t: string) => (db.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]).map((c) => c.name);
  for (const c of ["stability", "fsrsDifficulty", "fsrsState", "lastReviewAt", "sourcePage", "sourceQuote"]) assert.ok(cols("Card").includes(c), c);
  for (const c of ["pageStart", "pageEnd", "pageMap"]) assert.ok(cols("DeckChunk").includes(c), c);
  for (const c of ["aiProvider", "aiBaseUrl", "aiApiKey", "aiModel"]) assert.ok(cols("UserSettings").includes(c), c);
  for (const c of ["sourceType", "aiSource"]) assert.ok(cols("Deck").includes(c), c);
  db.close();
});
