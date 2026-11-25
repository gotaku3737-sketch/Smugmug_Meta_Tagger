// ============================================================
// Electron Main Process Entry Point
// ============================================================

import { app, BrowserWindow, shell, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import started from 'electron-squirrel-startup';
import { OAuthService } from './services/oauth';
import { SmugMugAPI } from './services/smugmug-api';
import { DatabaseService } from './services/database';
import { DownloaderService } from './services/downloader';
import { FaceEngine } from './services/face-engine';
import { TagExporterService } from './services/tag-exporter';
import { registerIpcHandlers } from './ipc-handlers';
import { PERSON_PREFIX, sanitizeKeywordPrefix } from '../shared/types';
import type { AppSettings } from '../shared/types';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// -----------------------------------------------------------
// Data & Model Directories
// -----------------------------------------------------------
const dataDir = path.join(app.getPath('userData'), 'smugmug-data');
// Models are bundled as extraResource in packaged builds or in repo models/ during development
const modelsDir = app.isPackaged
  ? path.join(process.resourcesPath, 'models')
  : path.join(app.getAppPath(), 'models');

// -----------------------------------------------------------
// Persistent Settings (stored in a simple JSON file)
// -----------------------------------------------------------
const settingsPath = path.join(dataDir, 'settings.json');

const DEFAULT_SETTINGS: AppSettings = {
  recognitionThreshold: 0.6,
  concurrentDownloads: 5,
  dataDirectory: dataDir,
  keywordFormat: 'prefixed',
  keywordPrefix: PERSON_PREFIX,
  autoSaveTagManifest: true,
  autoPurgeMediumCache: false,
  allowPublicUploads: false,
};

function normalizeSettings(raw: Partial<AppSettings>, base: AppSettings): AppSettings {
  const recognitionThreshold =
    typeof raw.recognitionThreshold === 'number' && Number.isFinite(raw.recognitionThreshold)
      ? Math.min(0.8, Math.max(0.4, raw.recognitionThreshold))
      : base.recognitionThreshold;

  const concurrentDownloads =
    typeof raw.concurrentDownloads === 'number' && Number.isFinite(raw.concurrentDownloads)
      ? Math.min(20, Math.max(1, Math.round(raw.concurrentDownloads)))
      : base.concurrentDownloads;

  const keywordFormat =
    raw.keywordFormat === 'plain' || raw.keywordFormat === 'prefixed'
      ? raw.keywordFormat
      : base.keywordFormat;

  const keywordPrefix =
    typeof raw.keywordPrefix === 'string'
      ? sanitizeKeywordPrefix(raw.keywordPrefix)
      : base.keywordPrefix;

  const autoSaveTagManifest =
    typeof raw.autoSaveTagManifest === 'boolean'
      ? raw.autoSaveTagManifest
      : base.autoSaveTagManifest;

  const autoPurgeMediumCache =
    typeof raw.autoPurgeMediumCache === 'boolean'
      ? raw.autoPurgeMediumCache
      : base.autoPurgeMediumCache;

  const allowPublicUploads =
    typeof raw.allowPublicUploads === 'boolean'
      ? raw.allowPublicUploads
      : base.allowPublicUploads;

  return {
    recognitionThreshold,
    concurrentDownloads,
    dataDirectory: base.dataDirectory,
    keywordFormat,
    keywordPrefix,
    autoSaveTagManifest,
    autoPurgeMediumCache,
    allowPublicUploads,
  };
}

function loadSettings(): AppSettings {
  try {
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      return normalizeSettings(JSON.parse(raw) as Partial<AppSettings>, DEFAULT_SETTINGS);
    }
  } catch {
    // ignore corrupt settings — start fresh
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings: AppSettings): void {
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    } else {
      try {
        fs.chmodSync(dataDir, 0o700);
      } catch (e) {
        // Ignore chmod errors on systems that don't support it
      }
    }
    // Security: Restrict file permissions to owner read/write (0o600)
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), { encoding: 'utf-8', mode: 0o600 });
    try {
      fs.chmodSync(settingsPath, 0o600);
    } catch (chmodErr) {
      // Ignore chmod errors on systems that don't support it (e.g., Windows)
    }
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
let tagExporter: TagExporterService;
let currentSettings: AppSettings;

function initializeServices(): void {
  currentSettings = loadSettings();

  oauth = new OAuthService(dataDir);
  api = new SmugMugAPI(oauth);
  db = new DatabaseService(dataDir);
  downloader = new DownloaderService(oauth, db, dataDir, currentSettings.concurrentDownloads);
  faceEngine = new FaceEngine(
    db,
    modelsDir,
    currentSettings.recognitionThreshold,
    () => currentSettings.autoPurgeMediumCache
  );
  tagExporter = new TagExporterService(db, dataDir, () => currentSettings);

  registerIpcHandlers({
    oauth,
    api,
    db,
    downloader,
    faceEngine,
    tagExporter,
    dataDir,
    getSettings: () => currentSettings,
    onSettingsUpdate: (partial) => {
      currentSettings = normalizeSettings(partial, currentSettings);
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
      sandbox: true,
    },
  });

  // Security: Handle window.open by opening in external browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsedUrl = new URL(url);
      if (['http:', 'https:', 'mailto:'].includes(parsedUrl.protocol)) {
        shell.openExternal(url);
      } else {
        console.warn(`[Security] Blocked window.open with insecure protocol: ${parsedUrl.protocol}`);
      }
    } catch (err) {
      console.warn('[Security] Blocked window.open with invalid URL:', err);
    }
    return { action: 'deny' };
  });

  // Security: Prevent navigation to outside URLs within the app
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const parsedUrl = new URL(url);
      // Depending on whether we are in dev (MAIN_WINDOW_VITE_DEV_SERVER_URL) or production, check the origin
      const isDevServer = typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== 'undefined' && parsedUrl.origin === MAIN_WINDOW_VITE_DEV_SERVER_URL;
      if (!isDevServer && parsedUrl.protocol !== 'file:') {
        event.preventDefault();
        console.warn(`[Security] Blocked navigation to external URL: ${url}`);
      }
    } catch (err) {
      event.preventDefault();
      console.warn('[Security] Blocked navigation to invalid URL:', err);
    }
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

app.on('web-contents-created', (event, contents) => {
  contents.on('will-attach-webview', (e) => {
    e.preventDefault();
  });
});

app.on('ready', () => {
  // Security: Deny all web permission requests (e.g., geolocation, media) by default
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    console.warn(`[Security] Blocked permission request for: ${permission}`);
    callback(false);
  });

  // Security: Deny all web permission checks to align with request handler and prevent bypasses
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    console.warn(`[Security] Blocked permission check for: ${permission}`);
    return false;
  });

  // Security: Add strict Content-Security-Policy and other security headers to all responses
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https: file:; connect-src 'self';"],
        'X-Content-Type-Options': ['nosniff'],
        'X-Frame-Options': ['DENY'],
        'X-XSS-Protection': ['1; mode=block'],
      },
    });
  });

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
