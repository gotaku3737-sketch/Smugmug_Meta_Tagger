// ============================================================
// IPC Handler Registration
// ============================================================

import { ipcMain, BrowserWindow, shell } from 'electron';
import type { OAuthService } from './services/oauth';
import type { SmugMugAPI } from './services/smugmug-api';
import type { DatabaseService } from './services/database';
import type { DownloaderService } from './services/downloader';
import type { FaceEngine } from './services/face-engine';
import type { BoundingBox, AppSettings } from '../shared/types';
import { sleep } from '../shared/utils';

interface Services {
  oauth: OAuthService;
  api: SmugMugAPI;
  db: DatabaseService;
  downloader: DownloaderService;
  faceEngine: FaceEngine;
  settings: AppSettings;
  onSettingsUpdate: (settings: Partial<AppSettings>) => void;
}

export function registerIpcHandlers(services: Services): void {
  const { oauth, api, db, downloader, faceEngine, settings, onSettingsUpdate } = services;

  // -----------------------------------------------------------
  // OAuth / SmugMug Auth
  // -----------------------------------------------------------

  ipcMain.handle('smugmug:setCredentials', async (_event, consumerKey: string, consumerSecret: string) => {
    oauth.setCredentials(consumerKey, consumerSecret);
  });

  ipcMain.handle('smugmug:startAuth', async () => {
    try {
      return await oauth.startAuth();
    } catch (err) {
      console.error('[IPC] smugmug:startAuth error:', err);
      throw new Error('An error occurred during authentication.');
    }
  });

  ipcMain.handle('smugmug:completeAuth', async (_event, verifier: string) => {
    try {
      return await oauth.completeAuth(verifier);
    } catch (err) {
      console.error('[IPC] smugmug:completeAuth error:', err);
      throw new Error('An error occurred during authentication completion.');
    }
  });

  ipcMain.handle('smugmug:getAuthStatus', async () => {
    return oauth.getAuthStatus();
  });

  ipcMain.handle('smugmug:disconnect', async () => {
    oauth.disconnect();
  });

  // -----------------------------------------------------------
  // Albums & Images
  // -----------------------------------------------------------

  ipcMain.handle('albums:sync', async () => {
    try {
      const albums = await api.getAlbums();
      for (const album of albums) {
        db.upsertAlbum(album.albumKey, album.title, album.imageCount, album.coverImageUrl);
      }
      return db.getAllAlbums();
    } catch (err) {
      console.error('[IPC] albums:sync error:', err);
      throw new Error('An error occurred during album synchronization.');
    }
  });

  ipcMain.handle('albums:getAll', async () => {
    return db.getAllAlbums();
  });

  ipcMain.handle('albums:getImages', async (_event, albumKey: string) => {
    try {
      // Sync images from SmugMug if we haven't stored them yet
      const existing = db.getImagesByAlbum(albumKey);
      if (existing.length === 0) {
        const images = await api.getAlbumImages(albumKey);
        for (const img of images) {
          db.upsertImage(
            img.imageKey,
            img.albumKey,
            img.filename,
            img.thumbUrl,
            img.mediumUrl,
            img.originalUrl,
            img.keywords
          );
        }
      }
      return db.getImagesByAlbum(albumKey);
    } catch (err) {
      console.error('[IPC] albums:getImages error:', err);
      throw new Error('An error occurred while fetching album images.');
    }
  });

  // -----------------------------------------------------------
  // Downloads
  // -----------------------------------------------------------

  ipcMain.handle('photos:downloadThumbnails', async (event, albumKey: string) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      downloader.onProgress((progress) => {
        win?.webContents.send('photos:downloadProgress', progress);
      });
      await downloader.downloadThumbnails(albumKey);
    } catch (err) {
      console.error('[IPC] photos:downloadThumbnails error:', err);
      throw new Error('An error occurred while downloading thumbnails.');
    }
  });

  ipcMain.handle('photos:downloadMedium', async (event, albumKey: string) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      downloader.onProgress((progress) => {
        win?.webContents.send('photos:downloadProgress', progress);
      });
      await downloader.downloadMedium(albumKey);
    } catch (err) {
      console.error('[IPC] photos:downloadMedium error:', err);
      throw new Error('An error occurred while downloading medium-res images.');
    }
  });

  // -----------------------------------------------------------
  // Face Detection & Training
  // -----------------------------------------------------------

  ipcMain.handle('faces:detectInAlbum', async (event, albumKey: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    faceEngine.onProgress((progress) => {
      win?.webContents.send('faces:detectionProgress', progress);
    });

    try {
      await faceEngine.detectInAlbum(albumKey);
    } catch (err) {
      console.error('[IPC] faces:detectInAlbum error:', err);
      throw new Error('An error occurred during face detection.');
    }
  });

  ipcMain.handle('faces:getPeople', async () => {
    return db.getAllPeople();
  });

  ipcMain.handle('faces:deletePerson', async (_event, personId: number) => {
    db.deletePerson(personId);
  });

  ipcMain.handle('faces:trainFace', async (
    _event,
    imageKey: string,
    bbox: BoundingBox,
    personName: string
  ) => {
    // Get the medium-res path for this image so we can extract the real descriptor
    const image = db.getImage(imageKey);
    if (!image) throw new Error(`Image not found: ${imageKey}`);

    if (image.mediumPath && image.mediumDownloaded) {
      // Run actual face detection and store real descriptor
      try {
        await faceEngine.trainFace(imageKey, image.mediumPath, bbox, personName);
      } catch (err) {
        console.error('[IPC] faces:trainFace error — falling back to zero descriptor:', err);
        const personId = db.addPerson(personName);
        db.addFaceDescriptor(personId, new Float32Array(128), imageKey, bbox);
      }
    } else {
      // Medium-res not downloaded yet — store placeholder
      const personId = db.addPerson(personName);
      db.addFaceDescriptor(personId, new Float32Array(128), imageKey, bbox);
    }
  });

  // -----------------------------------------------------------
  // Auto-Tagger
  // -----------------------------------------------------------

  ipcMain.handle('tags:runAutoTagger', async () => {
    try {
      await faceEngine.runAutoTagger();
    } catch (err) {
      console.error('[IPC] tags:runAutoTagger error:', err);
      throw new Error('An error occurred during auto-tagging.');
    }
  });

  ipcMain.handle('tags:getUntaggedResults', async () => {
    return db.getUntaggedImagesWithFaces();
  });

  ipcMain.handle('tags:approveMatches', async (_event, imageKey: string, approvedNames: string[]) => {
    faceEngine.approveMatches(imageKey, approvedNames);
  });

  ipcMain.handle('tags:uploadTags', async (event, imageKeys: string[]) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    let completed = 0;

    for (const imageKey of imageKeys) {
      const image = db.getImage(imageKey);
      if (!image || !image.detectedPeople) continue;

      const personNames = image.detectedPeople.map((p) => p.personName);
      const { mergeKeywords } = await import('../shared/types');
      const newKeywords = mergeKeywords(image.existingKeywords || '', personNames);

      try {
        await api.updateImageKeywords(imageKey, newKeywords);
        db.markTagsUploaded(imageKey);
      } catch (err) {
        console.error(`[IPC] Failed to upload tags for ${imageKey}:`, err);
      }

      completed++;
      win?.webContents.send('tags:uploadProgress', {
        completed,
        total: imageKeys.length,
        currentImage: image.filename,
      });

      // Respect SmugMug rate limits: ~5 req/s
      await sleep(200);
    }
  });

  // -----------------------------------------------------------
  // Settings & Stats
  // -----------------------------------------------------------

  ipcMain.handle('settings:get', async () => {
    return settings;
  });

  ipcMain.handle('settings:update', async (_event, partial: Partial<AppSettings>) => {
    onSettingsUpdate(partial);

    // Apply live settings changes
    if (partial.recognitionThreshold !== undefined) {
      faceEngine.setThreshold(partial.recognitionThreshold);
    }
  });

  ipcMain.handle('settings:getStats', async () => {
    return db.getStats();
  });

  ipcMain.handle('settings:clearTrainingData', async () => {
    db.clearTrainingData();
  });

  ipcMain.handle('settings:resetDatabase', async () => {
    db.resetDatabase();
  });

  // -----------------------------------------------------------
  // Utils
  // -----------------------------------------------------------

  ipcMain.handle('util:openExternal', async (_event, url: string) => {
    try {
      const parsedUrl = new URL(url);
      if (['http:', 'https:', 'mailto:'].includes(parsedUrl.protocol)) {
        await shell.openExternal(url);
      } else {
        console.warn(`[Security] Blocked util:openExternal with insecure protocol: ${parsedUrl.protocol}`);
      }
    } catch (err) {
      console.warn('[Security] Blocked util:openExternal with invalid URL:', err);
    }
  });
}
