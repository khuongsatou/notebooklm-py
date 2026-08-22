const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("notebooklmDesktop", {
  getAppInfo: () => ipcRenderer.invoke("app:info"),
  restartBackend: () => ipcRenderer.invoke("backend:restart"),
  openProfileLogin: () => ipcRenderer.invoke("notebooklm:open-profile-login"),
  profileLoginStatus: (loginId) => ipcRenderer.invoke("notebooklm:profile-login-status", loginId),
  finalizeProfileLogin: () => ipcRenderer.invoke("notebooklm:finalize-profile-login"),
  localLoginAndSync: () => ipcRenderer.invoke("notebooklm:local-login-sync"),
  resetLocalLogin: () => ipcRenderer.invoke("notebooklm:reset-local-login"),
  checkVpsConnected: () => ipcRenderer.invoke("notebooklm:check-vps-connected"),
  backendRequest: (request) => ipcRenderer.invoke("backend:request", request),
  onBackendStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("backend:status", listener);
    return () => ipcRenderer.removeListener("backend:status", listener);
  },
});
