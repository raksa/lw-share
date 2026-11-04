// The lw-share pages have no Content-Security-Policy, so Electron would log an
// "Insecure Content-Security-Policy" warning on every load. It is about the
// Electron shell, not lw-share, and would drown real console errors.
// Electron reads this flag from the page's main world, and the env-var form
// does not reach sandboxed renderers on Windows, hence exposeInMainWorld.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('ELECTRON_DISABLE_SECURITY_WARNINGS', true);
