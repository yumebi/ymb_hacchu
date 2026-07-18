const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getData: () => ipcRenderer.invoke('data:get'),
  setSenders: (senders) => ipcRenderer.invoke('data:setSenders', senders),
  setClients: (clients) => ipcRenderer.invoke('data:setClients', clients),
  saveOrder: (order) => ipcRenderer.invoke('data:saveOrder', order),
  deleteOrder: (id) => ipcRenderer.invoke('data:deleteOrder', id),
  exportPdf: (suggestedName) => ipcRenderer.invoke('pdf:export', suggestedName),
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  openUrl: (url) => ipcRenderer.invoke('update:openUrl', url)
});
