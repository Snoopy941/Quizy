// Preload for the Quizy desktop shell: exposes a minimal, safe window-control
// API to the web app. In a normal browser window.quizyDesktop is undefined.
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("quizyDesktop", {
  minimize: () => ipcRenderer.invoke("quizy:minimize"),
  toggleMaximize: () => ipcRenderer.invoke("quizy:toggleMaximize"),
  close: () => ipcRenderer.invoke("quizy:close"),
  isMaximized: () => ipcRenderer.invoke("quizy:isMaximized"),
  onMaximizeChange: (cb) => {
    // cb: (maximized: boolean) => void
    ipcRenderer.on("quizy:maximizeChanged", (_e, maximized) => cb(maximized));
  },
});
