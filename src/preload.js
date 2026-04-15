import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  ping: () => ipcRenderer.send('ping'),
  getPlatform: () => ipcRenderer.invoke("get-platform"),
});
