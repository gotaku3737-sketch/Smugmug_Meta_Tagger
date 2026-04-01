// ============================================================
// Tiered Photo Downloader
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import type { OAuthService } from './oauth';
import type { DatabaseService } from './database';
import type { DownloadProgress } from '../../shared/types';

export class DownloaderService {
  private oauth: OAuthService;
  private db: DatabaseService;
  private dataDir: string;
  private concurrentDownloads: number;
  private progressCallback?: (progress: DownloadProgress) => void;

  constructor(oauth: OAuthService, db: DatabaseService, dataDir: string, concurrentDownloads = 5) {
    this.oauth = oauth;
    this.db = db;
    this.dataDir = dataDir;
    this.concurrentDownloads = concurrentDownloads;
  }

  onProgress(callback: (progress: DownloadProgress) => void): void {
    this.progressCallback = callback;
  }

  // -----------------------------------------------------------
  // Download Thumbnails for an Album
  // -----------------------------------------------------------

  async downloadThumbnails(albumKey: string): Promise<void> {
    const images = this.db.getImagesByAlbum(albumKey);
    const toDownload = images.filter(img => !img.thumbDownloaded && img.thumbUrl);

    let completed = 0;
    const total = toDownload.length;

    if (total === 0) {
      this.db.markAlbumThumbsDownloaded(albumKey);
      return;
    }

    const thumbDir = path.join(this.dataDir, 'thumbnails', albumKey);
    if (!fs.existsSync(thumbDir)) {
      fs.mkdirSync(thumbDir, { recursive: true });
    }

    // Process in concurrent batches
    for (let i = 0; i < toDownload.length; i += this.concurrentDownloads) {
      const batch = toDownload.slice(i, i + this.concurrentDownloads);

      await Promise.all(
        batch.map(async (img) => {
          const destPath = path.join(thumbDir, img.filename);

          try {
            // Skip if file already exists
            if (fs.existsSync(destPath)) {
              this.db.markThumbDownloaded(img.imageKey, destPath);
              completed++;
              this.emitProgress(completed, total, img.filename, 'thumbnails');
              return;
            }

            await this.oauth.downloadFile(img.thumbUrl!, destPath);
            this.db.markThumbDownloaded(img.imageKey, destPath);
          } catch (err) {
            console.error(`Failed to download thumbnail for ${img.imageKey}:`, err);
          }

          completed++;
          this.emitProgress(completed, total, img.filename, 'thumbnails');
        })
      );

      // Yield to event loop between batches
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    this.db.markAlbumThumbsDownloaded(albumKey);
  }

  // -----------------------------------------------------------
  // Download Medium-Res for an Album (for face detection)
  // -----------------------------------------------------------

  async downloadMedium(albumKey: string): Promise<void> {
    const images = this.db.getImagesByAlbum(albumKey);
    const toDownload = images.filter(img => !img.mediumDownloaded && img.mediumUrl);

    let completed = 0;
    const total = toDownload.length;

    if (total === 0) return;

    const mediumDir = path.join(this.dataDir, 'medium', albumKey);
    if (!fs.existsSync(mediumDir)) {
      fs.mkdirSync(mediumDir, { recursive: true });
    }

    for (let i = 0; i < toDownload.length; i += this.concurrentDownloads) {
      const batch = toDownload.slice(i, i + this.concurrentDownloads);

      await Promise.all(
        batch.map(async (img) => {
          const destPath = path.join(mediumDir, img.filename);

          try {
            if (fs.existsSync(destPath)) {
              this.db.markMediumDownloaded(img.imageKey, destPath);
              completed++;
              this.emitProgress(completed, total, img.filename, 'medium');
              return;
            }

            await this.oauth.downloadFile(img.mediumUrl!, destPath);
            this.db.markMediumDownloaded(img.imageKey, destPath);
          } catch (err) {
            console.error(`Failed to download medium for ${img.imageKey}:`, err);
          }

          completed++;
          this.emitProgress(completed, total, img.filename, 'medium');
        })
      );

      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  // -----------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------

  private emitProgress(
    completed: number,
    total: number,
    currentFile: string,
    phase: DownloadProgress['phase']
  ): void {
    this.progressCallback?.({
      completed,
      total,
      currentFile,
      phase,
    });
  }
}
