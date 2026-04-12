// ============================================================
// Electron Main Process Entry Point
// ============================================================

import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import started from 'electron-squirrel-startup';
import { OAuthService } from './services/oauth';
import { SmugMugAPI } from './services/smugmug-api';
import { DatabaseService } from './services/database';
import { DownloaderService } from './services/downloader';
import { FaceEngine } from './services/face-engine';
import { registerIpcHandlers } from './ipc-handlers';
import type { AppSettings } from '../shared/types';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// -----------------------------------------------------------
// Data & Model Directories
// -----------------------------------------------------------
const dataDir = path.join(app.getPath('userData'), 'smugmug-data');
// Models are bundled in the repo's models/ directory
const modelsDir = path.join(app.getAppPath(), 'models');

// -----------------------------------------------------------
// Persistent Settings (stored in a simple JSON file)
// -----------------------------------------------------------
const settingsPath = path.join(dataDir, 'settings.json');

const DEFAULT_SETTINGS: AppSettings = {
  recognitionThreshold: 0.6,
  concurrentDownloads: 5,
  dataDirectory: dataDir,
};

function loadSettings(): AppSettings {
  try {
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch {
    // ignore corrupt settings — start fresh
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings: AppSettings): void {
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Settings] Failed to save:', err);
  }
}

// -----------------------------------------------------------
// Initialize Services
// -----------------------------------------------------------
let oauth: OAuthService;
let api: SmugMugAPI;
let db: DatabaseService;
let downloader: DownloaderService;
let faceEngine: FaceEngine;
let currentSettings: AppSettings;

function initializeServices(): void {
  currentSettings = loadSettings();

  oauth = new OAuthService(dataDir);
  api = new SmugMugAPI(oauth);
  db = new DatabaseService(dataDir);
  downloader = new DownloaderService(oauth, db, dataDir, currentSettings.concurrentDownloads);
  faceEngine = new FaceEngine(db, modelsDir, currentSettings.recognitionThreshold);

  registerIpcHandlers({
    oauth,
    api,
    db,
    downloader,
    faceEngine,
    settings: currentSettings,
    onSettingsUpdate: (partial) => {
      currentSettings = { ...currentSettings, ...partial };
      saveSettings(currentSettings);
    },
  });
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

  // Open DevTools in development
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
