const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('luxElectron', {
  onUpdateStatus(callback) {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('lux:update-status', listener);
    return () => ipcRenderer.removeListener('lux:update-status', listener);
  },
  installUpdate: () => ipcRenderer.invoke('lux:install-update'),
  downloadVod: (payload) => ipcRenderer.invoke('lux:download-vod', payload),
  openReaderSource: (url) => ipcRenderer.invoke('lux:reader-source', url)
});
