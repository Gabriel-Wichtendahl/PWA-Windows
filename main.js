const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow;
let alwaysOnTopState = true;

function applyAlwaysOnTop() {
  if (!mainWindow) return false;
  if (alwaysOnTopState) {
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
  } else {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.moveTop();
  }
  return alwaysOnTopState;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 430,
    height: 820,
    minWidth: 380,
    minHeight: 640,
    title: 'Deriv IC Panel',
    alwaysOnTop: alwaysOnTopState,
    resizable: true,
    backgroundColor: '#111827',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  applyAlwaysOnTop();
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
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

ipcMain.handle('is-always-on-top', () => {
  return alwaysOnTopState;
});
