// Quizy.exe launcher — runs inside the bundled Electron-Node runtime.
// Starts the Next.js server with paths resolved next to the exe, opens an
// app window, and shuts everything down when the window closes.
"use strict";

const { spawn, execFile } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
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
const PORT = 3927;
const BASE = `http://127.0.0.1:${PORT}`;

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
  // eslint-disable-next-line global-require
  const { app, BrowserWindow, shell, ipcMain } = require("electron");

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
        port: PORT,
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
    if (url.startsWith(BASE)) return { action: "allow" };
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

  waitForServer(load);
}

try {
  // eslint-disable-next-line global-require
  const { app } = require("electron");
  app.whenReady().then(startApp);
} catch (e) {
  fatal("Quizy could not start: " + (e && e.message));
}
