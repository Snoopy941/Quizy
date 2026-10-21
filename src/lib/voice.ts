/**
 * Speech-to-text for voice answers. Uses Whisper on Groq with Quizy's shared
 * key; falls back to a local whisper.cpp install if one was downloaded by an
 * older version of Quizy.
 */
import { execFile } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { WHISPER, isInstalled, modelsDir } from "./downloads";
import { QUIZY_AI_BASE, QUIZY_VOICE_MODEL, quizyAiKey } from "./quizy-ai";

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

/** Can voice answers be used at all? */
export function voiceAvailable(): boolean {
  return Boolean(quizyAiKey() || whisperPaths());
}

async function transcribeOnline(key: string, wav: Buffer, language?: string | null): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "answer.wav");
  form.append("model", QUIZY_VOICE_MODEL);
  form.append("response_format", "json");
  form.append("temperature", "0");
  if (language && language !== "auto") form.append("language", WHISPER_LANG[language] ?? language);
  let res: Response;
  try {
    res = await fetch(`${QUIZY_AI_BASE}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new Error("Couldn't reach the speech service. Check your internet connection and try again.");
  }
  if (res.status === 429) throw new Error("Voice answers are busy right now. Try again in a minute, or type your answer.");
  if (!res.ok) throw new Error("Speech recognition failed. Try again.");
  const data = (await res.json().catch(() => ({}))) as { text?: string };
  return cleanTranscript(data.text ?? "");
}

export function transcribeWav(wav: Buffer, language?: string | null): Promise<string> {
  const key = quizyAiKey();
  if (key) return transcribeOnline(key, wav, language);
  const p = whisperPaths();
  if (!p) return Promise.reject(new Error("Voice answers aren't available in this version of Quizy."));
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
