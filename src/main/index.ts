// ============================================================
// Electron Main Process Entry Point
// ============================================================

import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { OAuthService } from './services/oauth';
import { SmugMugAPI } from './services/smugmug-api';
import { DatabaseService } from './services/database';
import { DownloaderService } from './services/downloader';
import { registerIpcHandlers } from './ipc-handlers';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// -----------------------------------------------------------
// Data directory — stored alongside the app in userData
// -----------------------------------------------------------
const dataDir = path.join(app.getPath('userData'), 'smugmug-data');

// -----------------------------------------------------------
// Initialize Services
// -----------------------------------------------------------
let oauth: OAuthService;
let api: SmugMugAPI;
let db: DatabaseService;
let downloader: DownloaderService;

function initializeServices(): void {
  oauth = new OAuthService(dataDir);
  api = new SmugMugAPI(oauth);
  db = new DatabaseService(dataDir);
  downloader = new DownloaderService(oauth, db, dataDir);

  registerIpcHandlers({ oauth, api, db, downloader });
}

// -----------------------------------------------------------
// Window Creation
// -----------------------------------------------------------

const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0b0f',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load the renderer
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Open DevTools in dev mode
  if (process.env.NODE_ENV !== 'production') {
    mainWindow.webContents.openDevTools();
  }
};

// -----------------------------------------------------------
// App Lifecycle
// -----------------------------------------------------------

app.on('ready', () => {
  initializeServices();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  db?.close();
});
