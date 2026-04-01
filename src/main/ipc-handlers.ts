// ============================================================
// IPC Handler Registration
// ============================================================

import { ipcMain, BrowserWindow } from 'electron';
import type { OAuthService } from './services/oauth';
import type { SmugMugAPI } from './services/smugmug-api';
import type { DatabaseService } from './services/database';
import type { DownloaderService } from './services/downloader';
import type { BoundingBox } from '../shared/types';

interface Services {
  oauth: OAuthService;
  api: SmugMugAPI;
  db: DatabaseService;
  downloader: DownloaderService;
}

export function registerIpcHandlers(services: Services): void {
  const { oauth, api, db, downloader } = services;

  // -----------------------------------------------------------
  // OAuth / SmugMug Auth
  // -----------------------------------------------------------

  ipcMain.handle('smugmug:setCredentials', async (_event, consumerKey: string, consumerSecret: string) => {
    oauth.setCredentials(consumerKey, consumerSecret);
  });

  ipcMain.handle('smugmug:startAuth', async () => {
    return oauth.startAuth();
  });

  ipcMain.handle('smugmug:completeAuth', async (_event, verifier: string) => {
    return oauth.completeAuth(verifier);
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
    const albums = await api.getAlbums();
    for (const album of albums) {
      db.upsertAlbum(album.albumKey, album.title, album.imageCount, album.coverImageUrl);
    }
    return db.getAllAlbums();
  });

  ipcMain.handle('albums:getAll', async () => {
    return db.getAllAlbums();
  });

  ipcMain.handle('albums:getImages', async (_event, albumKey: string) => {
    // First sync images from SmugMug if we haven't yet
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
  });

  // -----------------------------------------------------------
  // Downloads
  // -----------------------------------------------------------

  ipcMain.handle('photos:downloadThumbnails', async (event, albumKey: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    downloader.onProgress((progress) => {
      win?.webContents.send('photos:downloadProgress', progress);
    });
    await downloader.downloadThumbnails(albumKey);
  });

  ipcMain.handle('photos:downloadMedium', async (event, albumKey: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    downloader.onProgress((progress) => {
      win?.webContents.send('photos:downloadProgress', progress);
    });
    await downloader.downloadMedium(albumKey);
  });

  // -----------------------------------------------------------
  // Faces
  // -----------------------------------------------------------

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
    // Ensure person exists
    const personId = db.addPerson(personName);

    // Create a placeholder descriptor for now — face-engine will be wired in Phase 3
    const placeholder = new Float32Array(128);
    db.addFaceDescriptor(personId, placeholder, imageKey, bbox);
  });

  // -----------------------------------------------------------
  // Tags
  // -----------------------------------------------------------

  ipcMain.handle('tags:getUntaggedResults', async () => {
    return db.getUntaggedImagesWithFaces();
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
        console.error(`Failed to upload tags for ${imageKey}:`, err);
      }

      completed++;
      win?.webContents.send('tags:uploadProgress', {
        completed,
        total: imageKeys.length,
        currentImage: image.filename,
      });

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  });

  // -----------------------------------------------------------
  // Settings & Stats
  // -----------------------------------------------------------

  ipcMain.handle('settings:getStats', async () => {
    return db.getStats();
  });

  ipcMain.handle('settings:clearTrainingData', async () => {
    db.clearTrainingData();
  });

  ipcMain.handle('settings:resetDatabase', async () => {
    db.resetDatabase();
  });
}
