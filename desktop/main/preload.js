// Contexto AI - Preload (contextIsolation bridge)
// The renderer runs with nodeIntegration off, so this is the only door
// between it and Node/Electron — keep the surface small and specific.
const { contextBridge, ipcRenderer, clipboard } = require('electron');

contextBridge.exposeInMainWorld('contexto', {
  getConfig:  ()      => ipcRenderer.invoke('config:get'),
  saveConfig: (cfg)   => ipcRenderer.invoke('config:save', cfg),
  llmQuery:   (data)  => ipcRenderer.invoke('llm:query', data),
  hidePanel:      ()  => ipcRenderer.send('window:hide'),
  togglePanel:    ()  => ipcRenderer.send('panel:toggle'),
  moveLauncherBy: (dx, dy) => ipcRenderer.send('launcher:move-by', { dx, dy }),
  // navigator.clipboard needs a secure context, which a file:// page isn't
  // guaranteed to be — Electron's own clipboard module always works.
  writeClipboard: (text) => clipboard.writeText(String(text ?? '')),
  openExternal:   (url)  => ipcRenderer.send('shell:open-external', url),
  onClipboardText: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('clipboard:new-text', listener);
    return () => ipcRenderer.removeListener('clipboard:new-text', listener);
  },
});
