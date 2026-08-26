const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopApi', {
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
})
