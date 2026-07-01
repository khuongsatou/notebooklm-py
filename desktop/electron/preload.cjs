const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("notebooklmDesktop", {
  getAppInfo: () => ipcRenderer.invoke("app:info"),
  backendRequest: (request) => ipcRenderer.invoke("backend:request", request),
  onBackendStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("backend:status", listener);
    return () => ipcRenderer.removeListener("backend:status", listener);
  },
});
