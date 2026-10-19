/**
 * Offline speech-to-text for voice answers, using whisper.cpp's CLI and the
 * multilingual base model (both downloaded on first use — see downloads.ts).
 */
import { execFile } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { WHISPER, isInstalled, modelsDir } from "./downloads";

export function whisperPaths(): { bin: string; model: string } | null {
  if (!isInstalled(WHISPER)) return null;
  const binDir = path.join(modelsDir(), "whisper", "bin");
  const candidates = ["whisper-cli.exe", "main.exe", "whisper-cli", "main"].map((f) => path.join(binDir, f));
  const bin = candidates.find((f) => fs.existsSync(f));
  const model = path.join(modelsDir(), "whisper", "ggml-base.bin");
  return bin && fs.existsSync(model) ? { bin, model } : null;
}

/** Our card-language codes → Whisper language codes ("auto" = detect). */
const WHISPER_LANG: Record<string, string> = { fil: "tl" };

export function cleanTranscript(stdout: string): string {
  return stdout
    .split(/\r?\n/)
    .map((l) => l.replace(/^\[[^\]]*\]\s*/, "").trim()) // strip "[00:00.000 --> 00:02.000]" if present
    .filter((l) => l && !/^\[(BLANK_AUDIO|MUSIC|NOISE)\]$/i.test(l) && !/^\((.*?)\)$/.test(l))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function transcribeWav(wav: Buffer, language?: string | null): Promise<string> {
  const p = whisperPaths();
  if (!p) return Promise.reject(new Error("Voice answers aren't downloaded yet — get them in Settings → Downloads."));
  const tmp = path.join(os.tmpdir(), `quizy-voice-${crypto.randomUUID()}.wav`);
  fs.writeFileSync(tmp, wav);
  const lang = !language || language === "auto" ? "auto" : WHISPER_LANG[language] ?? language;
  const threads = String(Math.max(2, Math.min(8, os.cpus().length - 1)));
  return new Promise<string>((resolve, reject) => {
    execFile(
      p.bin,
      ["-m", p.model, "-f", tmp, "-l", lang, "-nt", "-np", "-t", threads],
      { cwd: path.dirname(p.bin), timeout: 90_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        fs.rmSync(tmp, { force: true });
        if (err) reject(new Error("Speech recognition failed — try again."));
        else resolve(cleanTranscript(String(stdout)));
      }
    );
  });
}
