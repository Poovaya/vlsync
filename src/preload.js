import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  openFile: () => ipcRenderer.invoke("open-file"),
});
