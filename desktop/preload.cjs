'use strict'
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('jarynDesktop', {
  getConfig: () => ipcRenderer.invoke('jaryn:get-config'),
  setConfig: (serverUrl, apiToken) => ipcRenderer.invoke('jaryn:set-config', { serverUrl, apiToken }),
  openSetup: () => ipcRenderer.invoke('jaryn:open-setup'),
})
