// ============================================================
// IPC Handler Registration
// ============================================================

import { ipcMain, BrowserWindow, shell, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { OAuthService } from './services/oauth';
import type { SmugMugAPI } from './services/smugmug-api';
import type { DatabaseService } from './services/database';
import type { DownloaderService } from './services/downloader';
import type { FaceEngine } from './services/face-engine';
import { ensureSecureDir, type TagExporterService } from './services/tag-exporter';
import { mergeKeywords, removePersonKeyword } from '../shared/types';
import type {
  AlbumPrivacy,
  AppSettings,
  BoundingBox,
  KeywordDiffPreview,
  UploadTagsResult,
} from '../shared/types';
import { sleep } from '../shared/utils';

interface Services {
  oauth: OAuthService;
  api: SmugMugAPI;
  db: DatabaseService;
  downloader: DownloaderService;
  faceEngine: FaceEngine;
  tagExporter: TagExporterService;
  dataDir: string;
  getSettings: () => AppSettings;
  onSettingsUpdate: (settings: Partial<AppSettings>) => void;
}

// -----------------------------------------------------------
// IPC Runtime Input Validation Helpers
// -----------------------------------------------------------

function assertNonEmptyString(value: unknown, field: string, maxLength = 512): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${field}: expected string`);
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) {
    throw new Error(`Invalid ${field}: expected non-empty string (max ${maxLength} chars)`);
  }
  return trimmed;
}

function assertStringArray(value: unknown, field: string, maxItems = 10000): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error(`Invalid ${field}: expected string array`);
  }
  return value.map((item, idx) => assertNonEmptyString(item, `${field}[${idx}]`));
}

function assertBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid ${field}: expected boolean`);
  }
  return value;
}

function assertPositiveInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${field}: expected positive integer`);
  }
  return value;
}

function assertBoundingBox(value: unknown, field = 'bbox'): BoundingBox {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${field}: expected object`);
  }
  const box = value as Record<string, unknown>;
  const { x, y, width, height } = box;
  if (
    typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1 ||
    typeof y !== 'number' || !Number.isFinite(y) || y < 0 || y > 1 ||
    typeof width !== 'number' || !Number.isFinite(width) || width <= 0 || width > 1 ||
    typeof height !== 'number' || !Number.isFinite(height) || height <= 0 || height > 1
  ) {
    throw new Error(`Invalid ${field}: coordinates must be normalized finite numbers`);
  }
  return { x, y, width, height };
}

export function registerIpcHandlers(services: Services): void {
  const { oauth, api, db, downloader, faceEngine, tagExporter, dataDir, getSettings, onSettingsUpdate } = services;

  const sensitiveChannels = [
    'smugmug:setCredentials',
    'smugmug:completeAuth',
    'smugmug:disconnect',
    'settings:update',
    'settings:clearTrainingData',
    'settings:resetDatabase',
    'faces:deletePerson',
    'faces:forgetPerson',
    'faces:setPersonLocalOnly',
    'albums:setLocalOnly',
    'tags:importManifest',
  ];

  // Security: Wrap all IPC handlers to prevent leaking stack traces or sensitive details
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const safeHandle = (channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any) => {
    ipcMain.handle(channel, async (event, ...args) => {
      if (sensitiveChannels.includes(channel)) {
        console.log(`[Security Audit] Sensitive IPC channel invoked: ${channel}`);
      }

      try {
        return await listener(event, ...args);
      } catch (err) {
        console.error(`[IPC Error] ${channel}:`, err);
        throw new Error('An internal error occurred');
      }
    });
  };

  // -----------------------------------------------------------
  // OAuth / SmugMug Auth


  // -----------------------------------------------------------

  safeHandle('smugmug:setCredentials', async (_event, consumerKey: string, consumerSecret: string) => {
    const validKey = assertNonEmptyString(consumerKey, 'consumerKey', 256);
    const validSecret = assertNonEmptyString(consumerSecret, 'consumerSecret', 256);
    oauth.setCredentials(validKey, validSecret);
  });

  safeHandle('smugmug:startAuth', async () => {
    return oauth.startAuth();
  });

  safeHandle('smugmug:completeAuth', async (_event, verifier: string) => {
    const validVerifier = assertNonEmptyString(verifier, 'verifier', 128);
    return oauth.completeAuth(validVerifier);
  });

  safeHandle('smugmug:getAuthStatus', async () => {
    return oauth.getAuthStatus();
  });

  safeHandle('smugmug:disconnect', async (_event, clearConsumerKeys?: boolean) => {
    if (clearConsumerKeys !== undefined) {
      assertBoolean(clearConsumerKeys, 'clearConsumerKeys');
    }
    (oauth as unknown as { disconnect: (clear?: boolean) => void }).disconnect(Boolean(clearConsumerKeys));
  });

  // -----------------------------------------------------------
  // Albums & Images
  // -----------------------------------------------------------

  const syncAlbumImagesFromApi = async (albumKey: string) => {
    const images = await api.getAlbumImages(albumKey);
    for (const img of images) {
      db.upsertImage(
        img.imageKey,
        img.albumKey,
        img.filename,
        img.thumbUrl,
        img.mediumUrl,
        img.originalUrl,
        img.keywords,
        img.webUri
      );
    }
    return db.getImagesByAlbum(albumKey);
  };

  safeHandle('albums:sync', async () => {
    const albums = await api.getAlbums();
    for (const album of albums) {
      db.upsertAlbum(album.albumKey, album.title, album.imageCount, album.coverImageUrl, album.privacy);
    }
    return db.getAllAlbums();
  });

  safeHandle('albums:getAll', async () => {
    return db.getAllAlbums();
  });

  safeHandle('albums:getImages', async (_event, albumKey: string) => {
    const validKey = assertNonEmptyString(albumKey, 'albumKey', 128);
    // Sync images from SmugMug if we haven't stored them yet
    const existing = db.getImagesByAlbum(validKey);
    if (existing.length === 0) {
      try {
        return await syncAlbumImagesFromApi(validKey);
      } catch (err) {
        console.error('[IPC] albums:getImages error:', err);
        throw new Error('An error occurred while fetching album images.');
      }
    }
    return existing;
  });

  safeHandle('albums:refreshImages', async (_event, albumKey: string) => {
    const validKey = assertNonEmptyString(albumKey, 'albumKey', 128);
    return syncAlbumImagesFromApi(validKey);
  });

  safeHandle('albums:setLocalOnly', async (_event, albumKey: string, localOnly: boolean) => {
    const validKey = assertNonEmptyString(albumKey, 'albumKey', 128);
    const flag = assertBoolean(localOnly, 'localOnly');
    db.setAlbumLocalOnly(validKey, flag);
  });

  // -----------------------------------------------------------
  // Downloads
  // -----------------------------------------------------------

  safeHandle('photos:downloadThumbnails', async (event, albumKey: string) => {
    const validKey = assertNonEmptyString(albumKey, 'albumKey', 128);
    const win = BrowserWindow.fromWebContents(event.sender);
    downloader.onProgress((progress) => {
      win?.webContents.send('photos:downloadProgress', progress);
    });
    await downloader.downloadThumbnails(validKey);
  });

  safeHandle('photos:downloadMedium', async (event, albumKey: string) => {
    const validKey = assertNonEmptyString(albumKey, 'albumKey', 128);
    const win = BrowserWindow.fromWebContents(event.sender);
    downloader.onProgress((progress) => {
      win?.webContents.send('photos:downloadProgress', progress);
    });
    await downloader.downloadMedium(validKey);
  });

  // -----------------------------------------------------------
  // Face Detection & Training
  // -----------------------------------------------------------

  safeHandle('faces:detectInAlbum', async (event, albumKey: string) => {
    const validKey = assertNonEmptyString(albumKey, 'albumKey', 128);
    const win = BrowserWindow.fromWebContents(event.sender);
    faceEngine.onProgress((progress) => {
      win?.webContents.send('faces:detectionProgress', progress);
    });

    try {
      await faceEngine.detectInAlbum(validKey);
    } catch (err) {
      console.error('[IPC] faces:detectInAlbum error:', err);
      throw new Error('An error occurred during face detection.');
    }
  });

  safeHandle('faces:getPeople', async () => {
    return db.getAllPeople();
  });

  safeHandle('faces:deletePerson', async (_event, personId: number) => {
    const id = assertPositiveInt(personId, 'personId');
    db.deletePerson(id);
  });

  safeHandle('faces:setPersonLocalOnly', async (_event, personId: number, localOnly: boolean) => {
    const id = assertPositiveInt(personId, 'personId');
    const flag = assertBoolean(localOnly, 'localOnly');
    db.setPersonLocalOnly(id, flag);
  });

  safeHandle('faces:forgetPerson', async (_event, personId: number, removeFromSmugMug?: boolean) => {
    const id = assertPositiveInt(personId, 'personId');
    if (removeFromSmugMug !== undefined) {
      assertBoolean(removeFromSmugMug, 'removeFromSmugMug');
    }

    const { personName, affectedImageKeys } = db.forgetPersonLocal(id);
    tagExporter.syncManifestIfEnabled();

    let removedRemote = 0;
    if (removeFromSmugMug) {
      const currentSettings = getSettings();
      const formatOptions = {
        mode: currentSettings.keywordFormat,
        prefix: currentSettings.keywordPrefix,
      };

      for (const imageKey of affectedImageKeys) {
        const image = db.getImage(imageKey);
        if (!image || !image.tagsUploaded) continue;

        try {
          const freshKeywords = await api.getImageKeywords(imageKey);
          const { keywords: updatedKeywords, removed } = removePersonKeyword(
            freshKeywords,
            personName,
            formatOptions
          );

          if (removed) {
            await api.updateImageKeywords(imageKey, updatedKeywords);
            db.updateImageKeywords(imageKey, updatedKeywords);
            removedRemote++;
          }
        } catch (err) {
          console.error(`[IPC] Failed to remove keyword for "${personName}" from ${imageKey}:`, err);
        }

        await sleep(200);
      }
    }

    return { removedLocal: affectedImageKeys.length, removedRemote };
  });

  safeHandle('faces:trainFace', async (
    _event,
    imageKey: string,
    bbox: BoundingBox,
    personName: string
  ) => {
    const validImageKey = assertNonEmptyString(imageKey, 'imageKey', 128);
    const validBbox = assertBoundingBox(bbox, 'bbox');
    const validPersonName = assertNonEmptyString(personName, 'personName', 128);

    const image = db.getImage(validImageKey);
    if (!image) throw new Error(`Image not found: ${validImageKey}`);
    if (!image.mediumPath || !image.mediumDownloaded) {
      throw new Error(`Medium-resolution image is not downloaded for ${validImageKey}`);
    }

    await faceEngine.trainFace(validImageKey, image.mediumPath, validBbox, validPersonName);
  });

  // -----------------------------------------------------------
  // Auto-Tagger
  // -----------------------------------------------------------

  safeHandle('tags:runAutoTagger', async () => {
    try {
      await faceEngine.runAutoTagger();
      tagExporter.syncManifestIfEnabled();
    } catch (err) {
      console.error('[IPC] tags:runAutoTagger error:', err);
      throw new Error('An error occurred during auto-tagging.');
    }
  });

  safeHandle('tags:getUntaggedResults', async () => {
    return db.getUntaggedImagesWithFaces();
  });

  safeHandle('tags:approveMatches', async (_event, imageKey: string, approvedNames: string[]) => {
    const validImageKey = assertNonEmptyString(imageKey, 'imageKey', 128);
    const validApprovedNames = assertStringArray(approvedNames, 'approvedNames', 500);
    faceEngine.approveMatches(validImageKey, validApprovedNames);
    tagExporter.syncManifestIfEnabled();
  });

  safeHandle('tags:previewUpload', async (_event, imageKeys: string[]): Promise<KeywordDiffPreview[]> => {
    const validKeys = assertStringArray(imageKeys, 'imageKeys');
    const currentSettings = getSettings();
    const peopleByName = new Map(db.getAllPeople().map(p => [p.name, p]));
    const knownPeopleNames =
      currentSettings.keywordFormat === 'plain' ? Array.from(peopleByName.keys()) : [];

    const previews: KeywordDiffPreview[] = [];

    for (const imageKey of validKeys) {
      const image = db.getImage(imageKey);
      if (!image) continue;

      const album = db.getAlbum(image.albumKey);
      const albumTitle = album?.title ?? '';
      const albumPrivacy: AlbumPrivacy = album?.privacy ?? 'Unknown';
      const albumLocalOnly = Boolean(album?.localOnly);

      const approvedNames = db.getApprovedPersonNamesForImage(imageKey);
      const skippedPeople = approvedNames.filter(name => Boolean(peopleByName.get(name)?.localOnly));
      const uploadableNames = approvedNames.filter(name => !peopleByName.get(name)?.localOnly);
      const isLocalOnly = albumLocalOnly || (approvedNames.length > 0 && uploadableNames.length === 0);

      const beforeKeywords = image.existingKeywords || '';
      const previousPersonNames =
        currentSettings.keywordFormat === 'plain'
          ? [...knownPeopleNames, ...db.getTagSummary(imageKey).map(t => t.personName)]
          : undefined;

      const afterKeywords =
        isLocalOnly || uploadableNames.length === 0
          ? beforeKeywords
          : mergeKeywords(beforeKeywords, uploadableNames, {
              mode: currentSettings.keywordFormat,
              prefix: currentSettings.keywordPrefix,
              previousPersonNames,
            });

      previews.push({
        imageKey,
        filename: image.filename,
        albumKey: image.albumKey,
        albumTitle,
        albumPrivacy,
        beforeKeywords,
        afterKeywords,
        localOnly: isLocalOnly,
        skippedPeople,
      });
    }

    return previews;
  });

  safeHandle('tags:uploadTags', async (
    event,
    imageKeys: string[],
    options?: { allowPublic?: boolean }
  ): Promise<UploadTagsResult> => {
    const validKeys = assertStringArray(imageKeys, 'imageKeys');
    if (options !== undefined) {
      if (typeof options !== 'object' || options === null || Array.isArray(options)) {
        throw new Error('Invalid options: expected object');
      }
      if (options.allowPublic !== undefined) {
        assertBoolean(options.allowPublic, 'options.allowPublic');
      }
    }

    const win = BrowserWindow.fromWebContents(event.sender);
    const currentSettings = getSettings();
    const allowPublic = options?.allowPublic === true || currentSettings.allowPublicUploads === true;
    const peopleByName = new Map(db.getAllPeople().map(p => [p.name, p]));
    const knownPeopleNames =
      currentSettings.keywordFormat === 'plain' ? Array.from(peopleByName.keys()) : [];

    let uploaded = 0;
    let skippedPublic = 0;
    let skippedLocalOnly = 0;
    let skippedUnapproved = 0;
    let completed = 0;

    const emitProgress = (filename: string) => {
      completed++;
      win?.webContents.send('tags:uploadProgress', {
        completed,
        total: validKeys.length,
        currentImage: filename,
      });
    };

    for (const imageKey of validKeys) {
      const image = db.getImage(imageKey);
      if (!image) {
        emitProgress(imageKey);
        continue;
      }

      const album = db.getAlbum(image.albumKey);
      if (album?.localOnly) {
        skippedLocalOnly++;
        emitProgress(image.filename);
        continue;
      }

      const albumPrivacy: AlbumPrivacy = album?.privacy ?? 'Unknown';
      if ((albumPrivacy === 'Public' || albumPrivacy === 'Unlisted') && !allowPublic) {
        skippedPublic++;
        emitProgress(image.filename);
        continue;
      }

      const approvedNames = db.getApprovedPersonNamesForImage(imageKey);
      if (approvedNames.length === 0) {
        skippedUnapproved++;
        emitProgress(image.filename);
        continue;
      }

      const uploadableNames = approvedNames.filter(name => !peopleByName.get(name)?.localOnly);
      if (uploadableNames.length === 0) {
        skippedLocalOnly++;
        emitProgress(image.filename);
        continue;
      }

      // Fetch fresh keywords from SmugMug right before merging & PATCHing to avoid clobbering
      let freshKeywords: string;
      try {
        freshKeywords = await api.getImageKeywords(imageKey);
      } catch (err) {
        console.error(`[IPC] Failed to fetch fresh keywords for ${imageKey}, skipping upload:`, err);
        emitProgress(image.filename);
        await sleep(200);
        continue;
      }

      const previousPersonNames =
        currentSettings.keywordFormat === 'plain'
          ? [...knownPeopleNames, ...db.getTagSummary(imageKey).map(t => t.personName)]
          : undefined;

      const newKeywords = mergeKeywords(freshKeywords, uploadableNames, {
        mode: currentSettings.keywordFormat,
        prefix: currentSettings.keywordPrefix,
        previousPersonNames,
      });

      try {
        await api.updateImageKeywords(imageKey, newKeywords);
        db.updateImageKeywords(imageKey, newKeywords);
        db.markTagsUploaded(imageKey);
        uploaded++;
      } catch (err) {
        console.error(`[IPC] Failed to upload tags for ${imageKey}:`, err);
      }

      emitProgress(image.filename);

      // Respect SmugMug rate limits: ~5 req/s
      await sleep(200);
    }

    tagExporter.syncManifestIfEnabled();

    return {
      uploaded,
      skippedPublic,
      skippedLocalOnly,
      skippedUnapproved,
    };
  });

  safeHandle('tags:exportManifest', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const defaultPath = tagExporter.getDefaultManifestPath();
    ensureSecureDir(path.dirname(defaultPath));

    const dialogOptions: Electron.SaveDialogOptions = {
      title: 'Export Tag Manifest (JSON)',
      defaultPath,
      filters: [{ name: 'JSON Manifest', extensions: ['json'] }],
    };
    const { canceled, filePath } = win
      ? await dialog.showSaveDialog(win, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions);

    if (canceled || !filePath) {
      return { canceled: true, count: 0 };
    }

    const res = tagExporter.exportManifest(filePath);
    return { canceled: false, filePath: res.filePath, count: res.tagCount };
  });

  safeHandle('tags:importManifest', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const defaultPath = tagExporter.getDefaultManifestPath();
    ensureSecureDir(path.dirname(defaultPath));

    const dialogOptions: Electron.OpenDialogOptions = {
      title: 'Import Tag Manifest (JSON)',
      defaultPath,
      properties: ['openFile'],
      filters: [{ name: 'JSON Manifest', extensions: ['json'] }],
    };
    const { canceled, filePaths } = win
      ? await dialog.showOpenDialog(win, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (canceled || filePaths.length === 0) {
      return { canceled: true, importedCount: 0, skippedCount: 0 };
    }

    const res = tagExporter.importManifest(filePaths[0]);
    tagExporter.syncManifestIfEnabled();
    return {
      canceled: false,
      filePath: res.filePath,
      importedCount: res.importedCount,
      skippedCount: res.skippedCount,
    };
  });

  safeHandle('tags:exportCsv', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const defaultPath = tagExporter.getDefaultCsvPath();
    ensureSecureDir(path.dirname(defaultPath));

    const dialogOptions: Electron.SaveDialogOptions = {
      title: 'Export Tags to CSV',
      defaultPath,
      filters: [{ name: 'CSV File', extensions: ['csv'] }],
    };
    const { canceled, filePath } = win
      ? await dialog.showSaveDialog(win, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions);

    if (canceled || !filePath) {
      return { canceled: true, count: 0 };
    }

    const res = tagExporter.exportCsv(filePath);
    return { canceled: false, filePath: res.filePath, count: res.tagCount };
  });

  safeHandle('tags:exportXmp', async (event, albumKey?: string) => {
    const validAlbumKey = albumKey !== undefined ? assertNonEmptyString(albumKey, 'albumKey', 128) : undefined;
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const defaultDir = tagExporter.getDefaultXmpDir();
    ensureSecureDir(defaultDir);

    const dialogOptions: Electron.OpenDialogOptions = {
      title: 'Select Folder for XMP Sidecar Files',
      defaultPath: defaultDir,
      properties: ['openDirectory', 'createDirectory'],
    };
    const { canceled, filePaths } = win
      ? await dialog.showOpenDialog(win, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (canceled || filePaths.length === 0) {
      return { canceled: true, count: 0 };
    }

    const res = tagExporter.exportXmp(filePaths[0], validAlbumKey);
    return { canceled: false, filePath: res.directory, count: res.filesWritten };
  });

  // -----------------------------------------------------------
  // Settings & Stats
  // -----------------------------------------------------------

  safeHandle('settings:get', async () => {
    return getSettings();
  });

  safeHandle('settings:update', async (_event, partial: Partial<AppSettings>) => {
    if (typeof partial !== 'object' || partial === null || Array.isArray(partial)) {
      throw new Error('Invalid settings payload: expected object');
    }
    if (partial.recognitionThreshold !== undefined) {
      if (typeof partial.recognitionThreshold !== 'number' || !Number.isFinite(partial.recognitionThreshold)) {
        throw new Error('Invalid recognitionThreshold');
      }
    }
    if (partial.concurrentDownloads !== undefined) {
      if (typeof partial.concurrentDownloads !== 'number' || !Number.isFinite(partial.concurrentDownloads)) {
        throw new Error('Invalid concurrentDownloads');
      }
    }
    if (partial.keywordFormat !== undefined) {
      if (partial.keywordFormat !== 'prefixed' && partial.keywordFormat !== 'plain') {
        throw new Error('Invalid keywordFormat');
      }
    }
    if (partial.keywordPrefix !== undefined && typeof partial.keywordPrefix !== 'string') {
      throw new Error('Invalid keywordPrefix');
    }
    if (partial.autoSaveTagManifest !== undefined) {
      assertBoolean(partial.autoSaveTagManifest, 'autoSaveTagManifest');
    }
    if (partial.autoPurgeMediumCache !== undefined) {
      assertBoolean(partial.autoPurgeMediumCache, 'autoPurgeMediumCache');
    }
    if (partial.allowPublicUploads !== undefined) {
      assertBoolean(partial.allowPublicUploads, 'allowPublicUploads');
    }

    onSettingsUpdate(partial);

    // Apply live settings changes
    if (partial.recognitionThreshold !== undefined) {
      faceEngine.setThreshold(partial.recognitionThreshold);
    }
    if (partial.autoSaveTagManifest === true) {
      tagExporter.syncManifestIfEnabled();
    }
  });

  safeHandle('settings:getStats', async () => {
    return db.getStats();
  });

  safeHandle('settings:clearTrainingData', async () => {
    db.clearTrainingData();
    tagExporter.syncManifestIfEnabled();
  });

  safeHandle('settings:resetDatabase', async () => {
    db.resetDatabase();

    const resolvedDataDir = path.resolve(dataDir);
    const cleanupTargets = ['tags.json', 'thumbnails', 'medium', 'exports'];
    for (const target of cleanupTargets) {
      const targetPath = path.resolve(resolvedDataDir, target);
      if (!targetPath.startsWith(resolvedDataDir + path.sep)) continue;
      try {
        fs.rmSync(targetPath, { recursive: true, force: true });
      } catch (err) {
        console.warn(`[IPC] Failed to clean up ${targetPath} during resetDatabase:`, err);
      }
    }
  });

  // -----------------------------------------------------------
  // Utils
  // -----------------------------------------------------------

  safeHandle('util:openExternal', async (_event, url: string) => {
    const validUrl = assertNonEmptyString(url, 'url', 2048);
    try {
      const parsedUrl = new URL(validUrl);
      if (['http:', 'https:', 'mailto:'].includes(parsedUrl.protocol)) {
        await shell.openExternal(validUrl);
      } else {
        console.warn(`[Security] Blocked util:openExternal with insecure protocol: ${parsedUrl.protocol}`);
      }
    } catch (err) {
      console.warn('[Security] Blocked util:openExternal with invalid URL:', err);
    }
  });
}
