// Quizy.exe launcher — runs inside the bundled Electron-Node runtime.
// Starts the Next.js server with paths resolved next to the exe, opens an
// app window, and shuts everything down when the window closes.
"use strict";

const { spawn, execFile } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");

const EXE_DIR = path.dirname(process.execPath);
// Installed builds (NSIS) keep the Electron app in resources\app.asar and user
// data in %APPDATA%\Quizy; the portable layout keeps everything beside the exe.
const RESOURCES_DIR = path.join(EXE_DIR, "resources");
const INSTALLED = fs.existsSync(path.join(RESOURCES_DIR, "app.asar"));
const ROOT = INSTALLED ? RESOURCES_DIR : EXE_DIR;
const APP = path.join(ROOT, "app");
const NODE = path.join(ROOT, "bin", "node.exe");
const SERVER = path.join(APP, "server.js");
const DATA = INSTALLED
  ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Quizy")
  : path.join(ROOT, "data");
// Preferred port; if something else is using it we pick the next free one and
// record it in data\.port so the Quit helper can find the running server.
const PREFERRED_PORT = 3927;
let PORT = PREFERRED_PORT;
let BASE = `http://127.0.0.1:${PORT}`;
const portFile = path.join(DATA, ".port");

function findFreePort(from, tries, cb) {
  const srv = net.createServer();
  srv.once("error", () => (tries > 0 ? findFreePort(from + 1, tries - 1, cb) : cb(from)));
  srv.once("listening", () => srv.close(() => cb(from)));
  srv.listen(from, "127.0.0.1");
}

function runningPort() {
  try {
    const p = parseInt(fs.readFileSync(portFile, "utf8").trim(), 10);
    if (p > 0) return p;
  } catch (_) {}
  return PREFERRED_PORT;
}

// OCR language model ships in <root>\app\ocr (scanned PDFs work offline).
const OCR_DIR = path.join(APP, "ocr");

// Optional downloads (extra OCR languages) live outside the install folder
// so app updates never delete them, and outside the roaming profile.
const MODELS_DIR = INSTALLED
  ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Quizy", "models")
  : path.join(DATA, "models");
try {
  fs.mkdirSync(MODELS_DIR, { recursive: true });
} catch (_) {}

// Quizy no longer runs AI on this computer ("Quizy AI" is online). Free up the
// space older versions used: the offline AI model (~2 GB) and voice model.
try {
  for (const f of fs.readdirSync(MODELS_DIR)) {
    if (f.toLowerCase().endsWith(".gguf") || f.toLowerCase().endsWith(".gguf.part")) {
      fs.rmSync(path.join(MODELS_DIR, f), { force: true });
    }
  }
  fs.rmSync(path.join(MODELS_DIR, "whisper"), { recursive: true, force: true });
} catch (_) {}

function fatal(msg) {
  try {
    // eslint-disable-next-line global-require
    const { dialog } = require("electron");
    dialog.showErrorBox("Quizy", msg);
  } catch (_) {
    console.error(msg);
  }
  process.exit(1);
}

if (!fs.existsSync(SERVER)) fatal("Quizy app files are missing. Reinstall Quizy.");
if (!fs.existsSync(NODE)) fatal("The bundled runtime is missing (bin/node.exe). Reinstall Quizy.");

// First run of an installed build: seed the demo account + sample PDFs so the
// app is immediately explorable (demo@quizy.study / password123).
if (INSTALLED && !fs.existsSync(path.join(DATA, "quizy.db"))) {
  try {
    const seedDir = path.join(RESOURCES_DIR, "seed");
    fs.mkdirSync(DATA, { recursive: true });
    fs.mkdirSync(path.join(DATA, "uploads"), { recursive: true });
    const seedDb = path.join(seedDir, "quizy.db");
    if (fs.existsSync(seedDb)) fs.copyFileSync(seedDb, path.join(DATA, "quizy.db"));
    const seedUploads = path.join(seedDir, "uploads");
    if (fs.existsSync(seedUploads)) {
      for (const f of fs.readdirSync(seedUploads)) {
        fs.copyFileSync(path.join(seedUploads, f), path.join(DATA, "uploads", f));
      }
    }
  } catch (_) {}
}
fs.mkdirSync(path.join(DATA, "uploads"), { recursive: true });

// Stable per-install secret so login sessions survive restarts AND app
// bundle updates: lives in data/, which updates never touch.
const secretFile = path.join(DATA, ".quizy-secret");
const legacySecretFile = path.join(APP, ".quizy-secret");
let SECRET;
try {
  SECRET = fs.readFileSync(secretFile, "utf8").trim();
  if (SECRET.length < 20) throw new Error("weak");
} catch (_) {
  try {
    SECRET = fs.readFileSync(legacySecretFile, "utf8").trim();
    if (SECRET.length < 20) throw new Error("weak");
  } catch (_ignored) {
    SECRET = crypto.randomBytes(32).toString("hex");
  }
  try {
    fs.writeFileSync(secretFile, SECRET, { mode: 0o600 });
  } catch (_) {}
}

// Token so "Quit Quizy.exe" can stop the server without a browser session.
// Written only by the instance that actually starts the server; the --quit
// helper must read it, never overwrite it.
const quitToken = "qt-" + crypto.randomBytes(24).toString("hex");
const quitTokenFile = path.join(DATA, ".quit-token");

const dbUrl =
  process.env.QUIZY_DB_URL || "file:" + path.join(DATA, "quizy.db").split(path.sep).join("/");
const uploadsDir = path.join(DATA, "uploads");
const logFd = fs.openSync(path.join(DATA, "server.log"), "a");

let server = null;
let quitting = false;

function stopServer() {
  if (!server || server.killed) return;
  try {
    server.removeAllListeners("exit");
    server.kill();
  } catch (_) {}
  // Fallback: make sure the whole child tree is gone (Node child on Windows).
  try {
    execFile("taskkill", ["/pid", String(server.pid), "/T", "/F"], { windowsHide: true }, () => {});
  } catch (_) {}
}

function quit() {
  if (quitting) return;
  quitting = true;
  // Graceful first: ask the server to stop itself (flushes SQLite), then force.
  let token = "";
  try {
    token = fs.readFileSync(quitTokenFile, "utf8").trim();
  } catch (_) {}
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    stopServer();
    try {
      // eslint-disable-next-line global-require
      require("electron").app.exit(0);
    } catch (_) {}
    setTimeout(() => process.exit(0), 800).unref();
  };
  if (server && !server.killed && token) {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        path: "/api/quit",
        method: "POST",
        timeout: 2500,
        headers: { "x-quizy-quit": token },
      },
      (res) => {
        res.resume();
        res.on("end", () => setTimeout(finish, 400));
      }
    );
    req.on("error", finish);
    req.on("timeout", () => {
      req.destroy();
      finish();
    });
    req.end();
    setTimeout(finish, 3000).unref();
  } else {
    finish();
  }
}

function waitForServer(cb) {
  let tries = 240; // up to ~2 minutes on slow disks
  const attempt = () => {
    if (quitting) return;
    const req = http.get({ host: "127.0.0.1", port: PORT, path: "/login", timeout: 1500 }, (res) => {
      res.resume();
      cb();
    });
    req.on("error", () => {
      if (server && server.exitCode !== null) {
        fatal("Quizy failed to start. See Quizy\\data\\server.log for details.");
        return;
      }
      if (tries-- > 0) setTimeout(attempt, 500);
      else fatal("Quizy took too long to start. See Quizy\\data\\server.log for details.");
    });
    req.on("timeout", () => req.destroy());
  };
  attempt();
}

function startApp() {
  // --quit doesn't need a port of its own
  if (process.argv.includes("--quit")) return startAppWithPort();
  findFreePort(PREFERRED_PORT, 50, (p) => {
    PORT = p;
    BASE = `http://127.0.0.1:${PORT}`;
    startAppWithPort();
  });
}

function startAppWithPort() {
  // eslint-disable-next-line global-require
  const { app, BrowserWindow, shell, ipcMain, session } = require("electron");

  // --quit helper: tell the running instance to stop, then exit. Must run
  // before requestSingleInstanceLock so it works as a second instance.
  if (process.argv.includes("--quit")) {
    let token = "";
    try {
      token = fs.readFileSync(quitTokenFile, "utf8").trim();
    } catch (_) {}
    const req = http.request(
      {
        host: "127.0.0.1",
        port: runningPort(),
        path: "/api/quit",
        method: "POST",
        timeout: 3000,
        headers: { "x-quizy-quit": token },
      },
      (res) => {
        res.resume();
        res.on("end", () => app.exit(0));
      }
    );
    req.on("error", () => app.exit(0));
    req.on("timeout", () => {
      req.destroy();
      app.exit(0);
    });
    req.end();
    setTimeout(() => app.exit(0), 3500).unref();
    return;
  }

  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.exit(0);
    return;
  }

  try {
    fs.writeFileSync(quitTokenFile, quitToken, { mode: 0o600 });
    fs.writeFileSync(portFile, String(PORT));
  } catch (_) {}

  server = spawn(NODE, [SERVER], {
    cwd: APP,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      HOSTNAME: "127.0.0.1",
      DATABASE_URL: dbUrl,
      JWT_SECRET: SECRET,
      UPLOAD_DIR: uploadsDir,
      QUIZY_PORTABLE: "1",
      QUIZY_QUIT_TOKEN: quitToken,
      QUIZY_MODELS_DIR: MODELS_DIR,
      QUIZY_DATA_DIR: DATA,
      ...(fs.existsSync(OCR_DIR) ? { QUIZY_OCR_DIR: OCR_DIR } : {}),
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });

  server.on("exit", (code) => {
    if (quitting) return;
    if (code === 0 || code === undefined) {
      // Server was stopped intentionally (e.g. Quit helper via /api/quit):
      // close the whole app quietly instead of showing an error.
      quitting = true;
      try {
        // eslint-disable-next-line global-require
        require("electron").app.exit(0);
      } catch (_) {}
      setTimeout(() => process.exit(0), 500).unref();
      return;
    }
    fatal("The Quizy server stopped unexpectedly. See Quizy\\data\\server.log for details.");
  });

  app.on("window-all-closed", () => quit());
  app.on("before-quit", () => {
    quitting = true;
    stopServer();
  });

  const iconIco = path.join(APP, "quizy.ico");
  const iconPng = path.join(APP, "quizy-icon.png");
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 420,
    minHeight: 560,
    backgroundColor: "#000000",
    title: "Quizy",
    autoHideMenuBar: true,
    frame: false,              // no native title bar — the app draws its own
    titleBarStyle: "hidden",
    show: false,
    icon: fs.existsSync(iconIco) ? iconIco : fs.existsSync(iconPng) ? iconPng : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      plugins: true, // built-in PDF viewer ("Open PDF at page N")
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // Window controls from the web UI
  ipcMain.handle("quizy:minimize", () => win.minimize());
  ipcMain.handle("quizy:toggleMaximize", () => {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.handle("quizy:close", () => win.close());
  ipcMain.handle("quizy:isMaximized", () => win.isMaximized());
  const onMax = () => win.webContents.send("quizy:maximizeChanged", win.isMaximized());
  win.on("maximize", onMax);
  win.on("unmaximize", onMax);
  let retries = 0;
  const load = () => win.loadURL(BASE).catch(() => {});
  win.setMenuBarVisibility(false);
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => quit());
  win.webContents.on("did-fail-load", (_e, _code, _desc, url) => {
    if (!quitting && url && url.startsWith(BASE) && retries++ < 8) {
      setTimeout(load, 1000);
    }
  });
  // Diagnostic: verify the preload bridge and custom controls are alive
  // inside the real window. Appends one line to data\shell-check.log.
  win.webContents.on("did-finish-load", () => {
    setTimeout(() => {
      win.webContents
        .executeJavaScript(
          "JSON.stringify({bridge: !!window.quizyDesktop, controls: document.querySelectorAll('.app-drag button').length, drag: !!document.querySelector('.app-drag')})"
        )
        .then((v) => {
          try {
            fs.appendFileSync(
              path.join(DATA, "shell-check.log"),
              new Date().toISOString() + " " + v + "\n"
            );
          } catch (_) {}
        })
        .catch(() => {});
    }, 2500);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(BASE)) {
      // In-app links opened in a new window (e.g. a source PDF at a page)
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          backgroundColor: "#000000",
          icon: fs.existsSync(iconIco) ? iconIco : undefined,
          webPreferences: { contextIsolation: true, nodeIntegration: false, plugins: true },
        },
      };
    }
    try {
      shell.openExternal(url);
    } catch (_) {}
    return { action: "deny" };
  });

  app.on("second-instance", () => {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  // Allow the microphone (voice answers) and speech for our own pages only.
  try {
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb, details) => {
      const fromUs = String((details && details.requestingUrl) || "").startsWith(BASE);
      cb(fromUs && ["media", "clipboard-sanitized-write", "fullscreen", "notifications"].includes(permission));
    });
  } catch (_) {}

  setupAutoUpdates(win, ipcMain);
  setupPhoneAccess(ipcMain);
  waitForServer(load);
}

/* ---------------- automatic updates (installed builds only) ---------------- */
function setupAutoUpdates(win, ipcMain) {
  let updater = null;
  const send = (payload) => {
    try {
      if (win && !win.isDestroyed()) win.webContents.send("quizy:update", payload);
    } catch (_) {}
  };
  ipcMain.handle("quizy:checkForUpdates", async () => {
    if (!updater) return { status: "unsupported" };
    try {
      const r = await updater.checkForUpdates();
      return { status: "checked", version: r && r.updateInfo ? r.updateInfo.version : null };
    } catch (e) {
      return { status: "error", error: String((e && e.message) || e) };
    }
  });
  ipcMain.handle("quizy:installUpdate", () => {
    if (!updater) return false;
    quitting = true;
    stopServer();
    setTimeout(() => updater.quitAndInstall(true, true), 300);
    return true;
  });
  ipcMain.handle("quizy:appVersion", () => {
    try {
      return require("electron").app.getVersion();
    } catch (_) {
      return null;
    }
  });
  if (!INSTALLED || process.env.QUIZY_NO_UPDATES === "1") return;
  try {
    // eslint-disable-next-line global-require
    updater = require("electron-updater").autoUpdater;
  } catch (e) {
    return;
  }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.logger = {
    info: (m) => logLine("[updater] " + m),
    warn: (m) => logLine("[updater] " + m),
    error: (m) => logLine("[updater] " + m),
    debug: () => {},
  };
  updater.on("update-available", (i) => send({ status: "downloading", version: i.version, percent: 0 }));
  updater.on("download-progress", (p) => send({ status: "downloading", percent: Math.round(p.percent || 0) }));
  updater.on("update-downloaded", (i) => send({ status: "ready", version: i.version }));
  updater.on("error", (e) => logLine("[updater] error " + ((e && e.message) || e)));
  const check = () => updater.checkForUpdates().catch(() => {});
  setTimeout(check, 15000);
  setInterval(check, 6 * 60 * 60 * 1000).unref();
}

/* ---------------- study on your phone (same Wi-Fi) ---------------- */
// The app server only listens on 127.0.0.1. When the user turns phone access
// on, a small proxy listens on the local network and forwards to it — but only
// for devices that paired by scanning the QR code shown in Settings (they get a
// long random cookie). Everyone still has to sign in to their Quizy account.
const PHONE_COOKIE = "quizy_pair";
const phoneSecretFile = path.join(DATA, ".phone-secret");
const phoneEnabledFile = path.join(DATA, ".phone-enabled");
let phoneServer = null;
let phonePort = null;

function phoneSecret(reset) {
  let s = "";
  if (!reset) {
    try {
      s = fs.readFileSync(phoneSecretFile, "utf8").trim();
    } catch (_) {}
  }
  if (s.length < 32) {
    s = crypto.randomBytes(24).toString("hex");
    try {
      fs.writeFileSync(phoneSecretFile, s, { mode: 0o600 });
    } catch (_) {}
  }
  return s;
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== "IPv4" || a.internal) continue;
      if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) out.push(a.address);
    }
  }
  return out;
}

function phoneStatus() {
  const addrs = lanAddresses();
  const secret = phoneServer ? phoneSecret(false) : null;
  return {
    enabled: Boolean(phoneServer),
    port: phonePort,
    addresses: addrs,
    url: phoneServer && addrs.length ? `http://${addrs[0]}:${phonePort}/__pair?code=${secret}` : null,
  };
}

function readCookie(header, name) {
  for (const part of String(header || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

function startPhoneServer() {
  return new Promise((resolve) => {
    if (phoneServer) return resolve(phoneStatus());
    const secret = phoneSecret(false);
    const srv = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://x");
      if (url.pathname === "/__pair") {
        if (url.searchParams.get("code") === secret) {
          res.writeHead(302, {
            "Set-Cookie": `${PHONE_COOKIE}=${secret}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 180}`,
            Location: "/",
          });
        } else {
          res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
          res.write("<p style='font-family:sans-serif'>This pairing link has expired. Scan the QR code in Quizy → Settings again.</p>");
        }
        return res.end();
      }
      if (readCookie(req.headers.cookie, PHONE_COOKIE) !== secret) {
        res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(
          "<meta name=viewport content='width=device-width'><p style='font-family:sans-serif;padding:24px'>To study on this phone, open Quizy on your computer → Settings → <b>Study on your phone</b> and scan the QR code.</p>"
        );
      }
      if (url.pathname === "/api/quit") {
        res.writeHead(404);
        return res.end();
      }
      // Keep the phone's Host header so redirects point back at this proxy.
      const headers = { ...req.headers, "x-forwarded-for": req.socket.remoteAddress || "" };
      delete headers["x-quizy-quit"];
      const up = http.request({ host: "127.0.0.1", port: PORT, method: req.method, path: req.url, headers }, (r) => {
        res.writeHead(r.statusCode || 502, r.headers);
        r.pipe(res);
      });
      up.on("error", () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      req.pipe(up);
    });
    findFreePort(PORT + 10, 40, (p) => {
      srv.once("error", (e) => {
        logLine("[phone] could not listen: " + e.message);
        resolve(phoneStatus());
      });
      srv.listen(p, "0.0.0.0", () => {
        phoneServer = srv;
        phonePort = p;
        try {
          fs.writeFileSync(phoneEnabledFile, "1");
        } catch (_) {}
        logLine("[phone] listening on port " + p);
        resolve(phoneStatus());
      });
    });
  });
}

function stopPhoneServer() {
  if (phoneServer) {
    try {
      phoneServer.close();
    } catch (_) {}
  }
  phoneServer = null;
  phonePort = null;
  try {
    fs.rmSync(phoneEnabledFile, { force: true });
  } catch (_) {}
  return phoneStatus();
}

function setupPhoneAccess(ipcMain) {
  ipcMain.handle("quizy:phoneStatus", () => phoneStatus());
  ipcMain.handle("quizy:setPhoneAccess", async (_e, on) => (on ? startPhoneServer() : stopPhoneServer()));
  ipcMain.handle("quizy:resetPhonePairing", async () => {
    // New secret: every paired phone has to scan again.
    const wasOn = Boolean(phoneServer);
    stopPhoneServer();
    phoneSecret(true);
    return wasOn ? startPhoneServer() : phoneStatus();
  });
  if (fs.existsSync(phoneEnabledFile)) startPhoneServer();
}

function logLine(msg) {
  try {
    fs.appendFileSync(path.join(DATA, "server.log"), new Date().toISOString() + " " + msg + "\n");
  } catch (_) {}
}

try {
  // eslint-disable-next-line global-require
  const { app } = require("electron");
  app.whenReady().then(startApp);
} catch (e) {
  fatal("Quizy could not start: " + (e && e.message));
}
