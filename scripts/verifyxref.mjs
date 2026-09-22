import fs from "fs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const buf = fs.readFileSync("data/sample.pdf");
const s = buf.toString("latin1");
const startIdx = s.lastIndexOf("startxref");
const xrefPos = parseInt(s.slice(startIdx + 9).trim(), 10);
console.log("startxref ->", xrefPos, "bytes:", JSON.stringify(s.slice(xrefPos, xrefPos + 40)));
// parse first entry offset and check the object there
const xrefSection = s.slice(xrefPos);
const m = xrefSection.match(/xref\n0 (\d+)\n/);
console.log("count:", m && m[1]);
const entries = xrefSection.slice(xrefSection.indexOf("\n") + 1).split("\n");
const firstEntry = entries[2];
console.log("entry[1]:", JSON.stringify(firstEntry), "len:", firstEntry.length);
const off1 = parseInt(firstEntry.slice(0, 10), 10);
console.log("bytes at offset of obj 1:", JSON.stringify(s.slice(off1, off1 + 30)));
// check obj 3
const e3 = entries[4];
const off3 = parseInt(e3.slice(0, 10), 10);
console.log("bytes at offset of obj 3:", JSON.stringify(s.slice(off3, off3 + 30)));
