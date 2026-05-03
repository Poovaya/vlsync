import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  openFile: () => ipcRenderer.invoke('open-file'),

  // Send local play/pause/seek to MQTT
  sendAction: (cmd, mediaTimeMs) => ipcRenderer.invoke('sync-action', cmd, mediaTimeMs),

  // Returns current one-way ping estimate in ms (or null)
  getPing: () => ipcRenderer.invoke('get-ping'),

  // Register callback for incoming remote sync actions
  onRemoteAction: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('remote-action', handler);
    return () => ipcRenderer.removeListener('remote-action', handler);
  },

  getMqttStatus: () => ipcRenderer.invoke('get-mqtt-status'),

  // Register callback for MQTT connection status changes
  onMqttStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('mqtt-status', handler);
    return () => ipcRenderer.removeListener('mqtt-status', handler);
  },
});
