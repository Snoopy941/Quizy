import fs from "fs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse/lib/pdf-parse.js");
const buf = fs.readFileSync("data/sample.pdf");
console.log("file size:", buf.length, "header:", buf.subarray(0, 8).toString());
try {
  const d = await pdfParse(buf);
  console.log("OK, text length:", d.text.length);
  console.log(JSON.stringify(d.text.slice(0, 300)));
} catch (e) {
  console.log("PARSE ERROR:", e.message);
}
