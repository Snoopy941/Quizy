/**
 * Built-in offline AI: manages a bundled llama.cpp `llama-server` running a
 * small open model (Qwen3-4B-Instruct, Apache-2.0) on this computer.
 *
 * - Started lazily on the first AI request, stopped after 10 idle minutes
 *   to give the RAM back.
 * - Tries GPU offload first (Vulkan build), falls back to CPU if the GPU
 *   path fails to start.
 * - Two parallel slots: one for background card generation, one for
 *   interactive requests (Explain, answer checking) so those never wait
 *   behind a long generation job.
 *
 * Configured by the desktop launcher via env:
 *   QUIZY_LLAMA_BIN    path to llama-server(.exe)
 *   QUIZY_MODEL_PATH   path to the .gguf model
 *   QUIZY_LLAMA_PORT   port (default 3928)
 * or point LOCAL_AI_URL at an already-running OpenAI-compatible server.
 */
import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import net from "net";
import path from "path";
import { LLM_MODELS, modelsDir } from "./downloads";

export type LocalStatus = "unavailable" | "stopped" | "starting" | "ready" | "error";

interface LocalState {
  proc: ChildProcess | null;
  status: LocalStatus;
  error: string | null;
  gpu: boolean | null;
  starting: Promise<void> | null;
  idleTimer: NodeJS.Timeout | null;
  lastStderr: string[];
  port: number | null;
  modelInUse: string | null;
  lanes: Record<Lane, Semaphore>;
  exitHooked: boolean;
}

export type Lane = "generate" | "interactive";

class Semaphore {
  private queue: (() => void)[] = [];
  private active = 0;
  private readonly max: number;
  constructor(max: number) {
    this.max = max;
  }
  async acquire(): Promise<() => void> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    return () => {
      this.active--;
      this.queue.shift()?.();
    };
  }
  get pending() {
    return this.queue.length + this.active;
  }
}

const IDLE_MS = 10 * 60 * 1000;
const START_TIMEOUT_MS = 4 * 60 * 1000;

const g = globalThis as unknown as { __quizyLocalAi?: LocalState };
const state: LocalState = (g.__quizyLocalAi ??= {
  proc: null,
  status: "stopped",
  error: null,
  gpu: null,
  starting: null,
  idleTimer: null,
  lastStderr: [],
  port: null,
  modelInUse: null,
  lanes: { generate: new Semaphore(1), interactive: new Semaphore(1) },
  exitHooked: false,
});

function port(): number {
  return state.port ?? (Number(process.env.QUIZY_LLAMA_PORT) || 3928);
}

/** First free TCP port on 127.0.0.1 at or after `from`. */
export function findFreePort(from: number, tries = 50): Promise<number> {
  return new Promise((resolve, reject) => {
    const attempt = (p: number, left: number) => {
      const srv = net.createServer();
      srv.once("error", () => (left > 0 ? attempt(p + 1, left - 1) : reject(new Error("No free port found"))));
      srv.once("listening", () => srv.close(() => resolve(p)));
      srv.listen(p, "127.0.0.1");
    };
    attempt(from, tries);
  });
}

export function externalUrl(): string | null {
  const u = process.env.LOCAL_AI_URL?.trim();
  return u ? u.replace(/\/$/, "") : null;
}

export function binPath(): string | null {
  const p = process.env.QUIZY_LLAMA_BIN;
  return p && fs.existsSync(p) ? p : null;
}

const ACTIVE_FILE = "active-model.txt";

/** All .gguf models available: downloaded ones in the models folder, plus a bundled one. */
export function installedModels(): { file: string; path: string; id: string | null }[] {
  const out: { file: string; path: string; id: string | null }[] = [];
  const dir = modelsDir();
  for (const f of fs.readdirSync(dir)) {
    if (!f.toLowerCase().endsWith(".gguf")) continue;
    out.push({ file: f, path: path.join(dir, f), id: LLM_MODELS.find((m) => m.marker === f)?.id ?? null });
  }
  const bundled = process.env.QUIZY_MODEL_PATH;
  if (bundled && fs.existsSync(bundled) && !out.some((m) => m.file === path.basename(bundled))) {
    out.push({ file: path.basename(bundled), path: bundled, id: LLM_MODELS.find((m) => m.marker === path.basename(bundled))?.id ?? null });
  }
  return out;
}

/** Choose which installed model the built-in AI runs (restarts it on next use). */
export function setActiveModel(file: string) {
  fs.writeFileSync(path.join(modelsDir(), ACTIVE_FILE), file);
  if (state.modelInUse && path.basename(state.modelInUse) !== file) stopLocalServer();
}

export function modelPath(): string | null {
  const models = installedModels();
  if (!models.length) return null;
  let active = "";
  try {
    active = fs.readFileSync(path.join(modelsDir(), ACTIVE_FILE), "utf8").trim();
  } catch {}
  return (models.find((m) => m.file === active) ?? models[0]).path;
}

/** The engine is installed but no model yet (lite installer) — offer a download. */
export function needsModelDownload(): boolean {
  return Boolean(!externalUrl() && binPath() && !modelPath());
}

export function modelName(): string {
  if (externalUrl()) return process.env.LOCAL_AI_MODEL || "local model";
  const p = modelPath();
  if (!p) return "Qwen3-4B-Instruct";
  // "Qwen3-4B-Instruct-2507-Q3_K_S.gguf" → "Qwen3-4B-Instruct-2507"
  return path
    .basename(p)
    .replace(/\.gguf$/i, "")
    .replace(/[-_.]((UD-)?I?Q\d.*|F16|BF16|F32)$/i, "");
}

/** Is the built-in AI present in this install? */
export function localAvailable(): boolean {
  return Boolean(externalUrl() || (binPath() && modelPath()));
}

export function localStatus(): { status: LocalStatus; error: string | null; gpu: boolean | null; busy: number; port: number | null } {
  if (!localAvailable()) return { status: "unavailable", error: null, gpu: null, busy: 0, port: null };
  if (externalUrl()) return { status: "ready", error: null, gpu: null, busy: 0, port: null };
  return {
    status: state.status,
    error: state.error,
    gpu: state.gpu,
    busy: state.lanes.generate.pending + state.lanes.interactive.pending,
    port: state.port,
  };
}

/** Base URL of the running OpenAI-compatible endpoint, starting the server if needed. */
export async function ensureLocalServer(): Promise<string> {
  const ext = externalUrl();
  if (ext) return ext;
  if (!localAvailable()) throw new Error("The built-in AI isn't included in this install.");
  if (state.status === "ready" && state.proc && state.proc.exitCode === null) {
    touch();
    return `http://127.0.0.1:${port()}`;
  }
  if (!state.starting) {
    state.starting = start().finally(() => {
      state.starting = null;
    });
  }
  await state.starting;
  touch();
  return `http://127.0.0.1:${port()}`;
}

/** Run `fn` holding a slot in the given lane (keeps generation from starving interactive requests). */
export async function withLane<T>(lane: Lane, fn: () => Promise<T>): Promise<T> {
  if (externalUrl()) return fn();
  const release = await state.lanes[lane].acquire();
  try {
    touch();
    return await fn();
  } finally {
    release();
    touch();
  }
}

function touch() {
  if (state.idleTimer) clearTimeout(state.idleTimer);
  state.idleTimer = setTimeout(() => {
    const busy = state.lanes.generate.pending + state.lanes.interactive.pending;
    if (busy === 0) stopLocalServer();
    else touch();
  }, IDLE_MS);
  state.idleTimer.unref?.();
}

export function stopLocalServer() {
  const p = state.proc;
  state.proc = null;
  if (state.status !== "unavailable") state.status = "stopped";
  if (p && p.exitCode === null) {
    try {
      p.kill();
    } catch {}
  }
}

function hasGpuBackend(bin: string): boolean {
  try {
    return fs.readdirSync(path.dirname(bin)).some((f) => /^ggml-(vulkan|cuda|hip|sycl|metal)/i.test(f));
  } catch {
    return false;
  }
}

async function start(): Promise<void> {
  const bin = binPath()!;
  const model = modelPath()!;
  state.modelInUse = model;
  state.port = await findFreePort(Number(process.env.QUIZY_LLAMA_PORT) || 3928);
  state.status = "starting";
  state.error = null;
  if (!state.exitHooked) {
    state.exitHooked = true;
    process.once("exit", () => stopLocalServer());
  }

  const tryGpu = state.gpu !== false && process.env.QUIZY_LLAMA_GPU !== "0" && hasGpuBackend(bin);
  try {
    await launch(bin, model, tryGpu);
    state.gpu = tryGpu;
  } catch (err) {
    if (!tryGpu) throw fail(err);
    console.warn("[local-ai] GPU start failed, retrying on CPU:", err instanceof Error ? err.message : err);
    try {
      await launch(bin, model, false);
      state.gpu = false;
    } catch (err2) {
      throw fail(err2);
    }
  }
  state.status = "ready";
  console.log(`[local-ai] ready on port ${port()} (${state.gpu ? "GPU" : "CPU"})`);
}

function fail(err: unknown): Error {
  const tail = state.lastStderr.slice(-6).join(" | ");
  const msg = `The built-in AI failed to start${tail ? `: ${tail}` : ""}`;
  state.status = "error";
  state.error = err instanceof Error && err.message.startsWith("The built-in AI") ? err.message : msg;
  return new Error(state.error);
}

function launch(bin: string, model: string, gpu: boolean): Promise<void> {
  const threads = process.env.QUIZY_LLAMA_THREADS;
  const args = [
    "-m", model,
    "--host", "127.0.0.1",
    "--port", String(port()),
    "-c", process.env.QUIZY_LLAMA_CTX || "8192",
    "-np", "2",
    "--jinja",
    "-ngl", gpu ? "99" : "0",
  ];
  if (threads) args.push("-t", threads);
  state.lastStderr = [];

  return new Promise<void>((resolve, reject) => {
    const proc = spawn(bin, args, { cwd: path.dirname(bin), stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    state.proc = proc;
    let settled = false;
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timeout);
      if (err) {
        try {
          proc.kill();
        } catch {}
        if (state.proc === proc) state.proc = null;
        reject(err);
      } else resolve();
    };
    proc.stderr?.setEncoding("utf8");
    proc.stderr?.on("data", (d: string) => {
      for (const line of d.split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        state.lastStderr.push(t.slice(0, 300));
        if (state.lastStderr.length > 40) state.lastStderr.shift();
      }
    });
    proc.on("error", (e) => done(e));
    proc.on("exit", (code) => {
      if (!settled) done(new Error(`llama-server exited with code ${code}`));
      else if (state.proc === proc) {
        state.proc = null;
        if (state.status === "ready") state.status = "stopped";
      }
    });
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${port()}/health`, { signal: AbortSignal.timeout(1500) });
        if (r.ok) done();
      } catch {
        /* still loading */
      }
    }, 700);
    const timeout = setTimeout(() => done(new Error("Timed out loading the AI model")), START_TIMEOUT_MS);
  });
}
