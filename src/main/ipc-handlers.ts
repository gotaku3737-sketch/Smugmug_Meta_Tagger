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





  // Security: Wrap all IPC handlers to prevent leaking stack traces or sensitive details
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const safeHandle = (channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any) => {
    ipcMain.handle(channel, async (event, ...args) => {
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
    oauth.setCredentials(consumerKey, consumerSecret);
  });

  safeHandle('smugmug:startAuth', async () => {
    return oauth.startAuth();
  });

  safeHandle('smugmug:completeAuth', async (_event, verifier: string) => {
    return oauth.completeAuth(verifier);
  });

  safeHandle('smugmug:getAuthStatus', async () => {
    return oauth.getAuthStatus();
  });

  safeHandle('smugmug:disconnect', async () => {
    oauth.disconnect();
  });

  // -----------------------------------------------------------
  // Albums & Images
  // -----------------------------------------------------------

  safeHandle('albums:sync', async () => {
    const albums = await api.getAlbums();
    for (const album of albums) {
      db.upsertAlbum(album.albumKey, album.title, album.imageCount, album.coverImageUrl);
    }
  });

  safeHandle('albums:getAll', async () => {
    return db.getAllAlbums();
  });

  safeHandle('albums:getImages', async (_event, albumKey: string) => {
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
      return db.getImagesByAlbum(albumKey);
    } catch (err) {
      console.error('[IPC] albums:getImages error:', err);
      throw new Error('An error occurred while fetching album images.');
    }
  });

  // -----------------------------------------------------------
  // Downloads
  // -----------------------------------------------------------

  safeHandle('photos:downloadThumbnails', async (event, albumKey: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    downloader.onProgress((progress) => {
      win?.webContents.send('photos:downloadProgress', progress);
    });
    await downloader.downloadThumbnails(albumKey);
  });

  safeHandle('photos:downloadMedium', async (event, albumKey: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    downloader.onProgress((progress) => {
      win?.webContents.send('photos:downloadProgress', progress);
    });
    await downloader.downloadMedium(albumKey);
  });

  // -----------------------------------------------------------
  // Face Detection & Training
  // -----------------------------------------------------------

  safeHandle('faces:detectInAlbum', async (event, albumKey: string) => {
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

  safeHandle('faces:getPeople', async () => {
    return db.getAllPeople();
  });

  safeHandle('faces:deletePerson', async (_event, personId: number) => {
    db.deletePerson(personId);
  });

  safeHandle('faces:trainFace', async (
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

  safeHandle('tags:runAutoTagger', async () => {
    try {
      await faceEngine.runAutoTagger();
    } catch (err) {
      console.error('[IPC] tags:runAutoTagger error:', err);
      throw new Error('An error occurred during auto-tagging.');
    }
  });

  safeHandle('tags:getUntaggedResults', async () => {
    return db.getUntaggedImagesWithFaces();
  });

  safeHandle('tags:approveMatches', async (_event, imageKey: string, approvedNames: string[]) => {
    faceEngine.approveMatches(imageKey, approvedNames);
  });

  safeHandle('tags:uploadTags', async (event, imageKeys: string[]) => {
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

  safeHandle('settings:get', async () => {
    return settings;
  });

  safeHandle('settings:update', async (_event, partial: Partial<AppSettings>) => {
    onSettingsUpdate(partial);

    // Apply live settings changes
    if (partial.recognitionThreshold !== undefined) {
      faceEngine.setThreshold(partial.recognitionThreshold);
    }
  });

  safeHandle('settings:getStats', async () => {
    return db.getStats();
  });

  safeHandle('settings:clearTrainingData', async () => {
    db.clearTrainingData();
  });

  safeHandle('settings:resetDatabase', async () => {
    db.resetDatabase();
  });

  // -----------------------------------------------------------
  // Utils
  // -----------------------------------------------------------

  safeHandle('util:openExternal', async (_event, url: string) => {
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
