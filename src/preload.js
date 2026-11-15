'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hub', {
  data: () => ipcRenderer.invoke('hub:data'),
  pomOk: () => ipcRenderer.invoke('pom:ok'),
  clipRead: () => ipcRenderer.invoke('clip:read'),
  clipWrite: (t) => ipcRenderer.send('clip:write', t),
  openConfig: () => ipcRenderer.invoke('open:config'),
  termCreate: (id, cols, rows, sessionId) => ipcRenderer.invoke('term:create', id, cols, rows, sessionId),
  termWrite: (id, d) => ipcRenderer.send('term:write', id, d),
  termResize: (id, c, r) => ipcRenderer.send('term:resize', id, c, r),
  termKill: (id) => ipcRenderer.send('term:kill', id),
  onTermData: (fn) => ipcRenderer.on('term:data', (_e, id, d) => fn(id, d)),
  onTermExit: (fn) => ipcRenderer.on('term:exit', (_e, id, code) => fn(id, code)),
  activityStart: () => ipcRenderer.invoke('activity:start'),
  activityFollow: (sessionId) => ipcRenderer.send('activity:follow', sessionId),
  onActivity: (fn) => ipcRenderer.on('activity', (_e, ev) => fn(ev)),
});
