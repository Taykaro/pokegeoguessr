// Pont sécurisé menu (renderer) -> processus principal (choix du mode).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pokegeo', {
  chooseMode: (cfg) => ipcRenderer.send('pokegeo:mode', cfg),
});
