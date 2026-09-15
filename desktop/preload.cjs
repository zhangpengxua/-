const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktopSettings', {
  read: () => ipcRenderer.invoke('settings:read'),
  save: values => ipcRenderer.invoke('settings:save', values),
  preview: () => ipcRenderer.invoke('settings:preview'),
});
