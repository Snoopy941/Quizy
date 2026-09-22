// Generates icon assets from the master Quizy logo PNG (no native deps):
//   src/app/icon.png            (512) Next.js file-convention favicon
//   src/components/quizy-logo.png (256) imported by the Logo component
//   dist/Quizy/app/quizy-icon.png (256) Electron window/taskbar icon (copied at build)
//   dist/Quizy/app/quizy.ico    (256/48/32/16) exe icon, applied with rcedit
//
// Usage: node scripts/make-icons.js <master.png> [outdir]
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// ---------- PNG decode ----------
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("Not a PNG");
  let pos = 8;
  let width = 0,
    height = 0,
    bitDepth = 0,
    colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (bitDepth !== 8) throw new Error("Unsupported bit depth " + bitDepth);
      if (colorType !== 6 && colorType !== 2)
        throw new Error("Unsupported color type " + colorType + " (want RGB or RGBA)");
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") break;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  // Un-filter (PNG filters 0-4)
  const out = Buffer.alloc(height * stride);
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
    prev.set(cur);
  }
  // Expand RGB -> RGBA
  if (channels === 3) {
    const rgba = Buffer.alloc(height * width * 4);
    for (let i = 0; i < width * height; i++) {
      rgba[i * 4] = out[i * 3];
      rgba[i * 4 + 1] = out[i * 3 + 1];
      rgba[i * 4 + 2] = out[i * 3 + 2];
      rgba[i * 4 + 3] = 255;
    }
    return { width, height, data: rgba };
  }
  return { width, height, data: out };
}

// ---------- area-average resize ----------
function resize(img, tw, th) {
  const { width: sw, height: sh, data: sd } = img;
  const out = Buffer.alloc(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const sy0 = Math.floor((y * sh) / th);
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * sh) / th));
    for (let x = 0; x < tw; x++) {
      const sx0 = Math.floor((x * sw) / tw);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * sw) / tw));
      let r = 0,
        g = 0,
        b = 0,
        a = 0,
        n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * sw + sx) * 4;
          const al = sd[i + 3];
          r += sd[i] * al;
          g += sd[i + 1] * al;
          b += sd[i + 2] * al;
          a += al;
          n++;
        }
      }
      const o = (y * tw + x) * 4;
      const alpha = a / n;
      if (alpha === 0) {
        out[o + 3] = 0;
      } else {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
        out[o + 3] = Math.round(alpha);
      }
    }
  }
  return { width: tw, height: th, data: out };
}

// ---------- PNG encode (RGBA, filter 0) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePNG(img) {
  const { width, height, data } = img;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const filtered = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    filtered[y * (width * 4 + 1)] = 0; // filter: none
    data.copy(filtered, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(filtered, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- ICO builder (PNG-compressed entries) ----------
function buildICO(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(count, 4);
  const entries = [];
  let offset = 6 + 16 * count;
  for (const { size, png } of pngs) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e[2] = 0;
    e[3] = 0;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.png)]);
}

// ---------- main ----------
const masterPath = process.argv[2] || "logo-master.png";
const outDir = process.argv[3] || ".";
const master = decodePNG(fs.readFileSync(masterPath));

const sizes = [16, 32, 48, 256, 512];
const rendered = {};
for (const s of sizes) rendered[s] = encodePNG(resize(master, s, s));

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "icon-512.png"), rendered[512]);
fs.writeFileSync(path.join(outDir, "quizy-logo.png"), rendered[256]);
fs.writeFileSync(path.join(outDir, "quizy-icon.png"), rendered[256]);
fs.writeFileSync(
  path.join(outDir, "quizy.ico"),
  buildICO([256, 48, 32, 16].map((s) => ({ size: s, png: rendered[s] })))
);
console.log(
  "icons written:",
  sizes.join(", "),
  "->",
  outDir,
  "(master",
  master.width + "x" + master.height + ")"
);
