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
  // Lets the panel (which has the task data) tell the launcher (always
  // visible, even minimized) how many things need attention right now.
  setDueCount: (count) => ipcRenderer.send('launcher:due-count', count),
  // Lets the panel push its current today's-tasks list to the tray menu, so
  // it's visible at a glance without opening the panel.
  setTrayTasks: (tasks) => ipcRenderer.send('tray:update-tasks', tasks),
  onDueCount: (cb) => {
    const listener = (_e, count) => cb(count);
    ipcRenderer.on('due-count-update', listener);
    return () => ipcRenderer.removeListener('due-count-update', listener);
  },
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
