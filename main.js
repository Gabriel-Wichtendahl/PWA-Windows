const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow;
let alwaysOnTopState = true;
let keepTopTimer = null;

function forceTop() {
  if (!mainWindow || mainWindow.isDestroyed() || !alwaysOnTopState) return;
  // En Windows, `pop-up-menu` o superior queda por encima de ventanas normales y de la barra de tareas.
  // Reaplicamos porque algunas apps/navegadores pueden tomar el z-order al recibir foco.
  mainWindow.setAlwaysOnTop(true, 'pop-up-menu');
  mainWindow.moveTop();
}

function startKeepTopLoop() {
  if (keepTopTimer) clearInterval(keepTopTimer);
  if (!alwaysOnTopState) return;
  keepTopTimer = setInterval(forceTop, 1200);
}

function stopKeepTopLoop() {
  if (keepTopTimer) clearInterval(keepTopTimer);
  keepTopTimer = null;
}

function applyAlwaysOnTop() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { enabled: alwaysOnTopState, actual: false };
  }

  if (alwaysOnTopState) {
    mainWindow.setAlwaysOnTop(true, 'pop-up-menu');
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mainWindow.show();
    mainWindow.moveTop();
    startKeepTopLoop();
  } else {
    stopKeepTopLoop();
    mainWindow.setAlwaysOnTop(false, 'normal');
    mainWindow.setVisibleOnAllWorkspaces(false);
  }

  return { enabled: alwaysOnTopState, actual: mainWindow.isAlwaysOnTop() };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 470,
    height: 860,
    minWidth: 405,
    minHeight: 660,
    title: 'Deriv IC Panel',
    alwaysOnTop: true,
    autoHideMenuBar: true,
    resizable: true,
    backgroundColor: '#111827',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.on('blur', () => {
    if (alwaysOnTopState) setTimeout(forceTop, 50);
  });

  mainWindow.on('always-on-top-changed', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('always-on-top-state', applyAlwaysOnTop());
  });

  mainWindow.on('closed', () => {
    stopKeepTopLoop();
    mainWindow = null;
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  applyAlwaysOnTop();
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('toggle-always-on-top', () => {
  alwaysOnTopState = !alwaysOnTopState;
  return applyAlwaysOnTop();
});

ipcMain.handle('set-always-on-top', (_event, enabled) => {
  alwaysOnTopState = Boolean(enabled);
  return applyAlwaysOnTop();
});

ipcMain.handle('is-always-on-top', () => {
  return applyAlwaysOnTop();
});

ipcMain.handle('get-otp-websocket-url', async (_event, { appId, token, accountId }) => {
  const cleanAppId = String(appId || '').trim();
  const cleanToken = String(token || '').trim();
  const cleanAccountId = String(accountId || '').trim();

  if (!cleanAppId) throw new Error('Falta App ID nuevo de Deriv.');
  if (!cleanToken) throw new Error('Falta Authorization token / Bearer token.');
  if (!cleanAccountId) throw new Error('Falta Account ID de Options.');

  const url = `https://api.derivws.com/trading/v1/options/accounts/${encodeURIComponent(cleanAccountId)}/otp`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Deriv-App-ID': cleanAppId,
      'Authorization': `Bearer ${cleanToken}`
    }
  });

  let body;
  try {
    body = await response.json();
  } catch (_) {
    body = null;
  }

  if (!response.ok) {
    const msg = body?.errors?.[0]?.message || body?.message || `HTTP ${response.status}`;
    throw new Error(msg);
  }

  const wsUrl = body?.data?.url;
  if (!wsUrl) throw new Error('Deriv no devolvió URL WebSocket OTP.');
  return wsUrl;
});

ipcMain.handle('get-options-accounts', async (_event, { appId, token }) => {
  const cleanAppId = String(appId || '').trim();
  const cleanToken = String(token || '').trim();

  if (!cleanAppId) throw new Error('Falta App ID nuevo de Deriv.');
  if (!cleanToken) throw new Error('Falta Authorization token / Bearer token.');

  const response = await fetch('https://api.derivws.com/trading/v1/options/accounts', {
    method: 'GET',
    headers: {
      'Deriv-App-ID': cleanAppId,
      'Authorization': `Bearer ${cleanToken}`
    }
  });

  let body;
  try {
    body = await response.json();
  } catch (_) {
    body = null;
  }

  if (!response.ok) {
    const msg = body?.errors?.[0]?.message || body?.message || `HTTP ${response.status}`;
    throw new Error(msg);
  }

  return body?.data || body;
});
