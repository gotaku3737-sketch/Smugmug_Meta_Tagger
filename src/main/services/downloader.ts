// ============================================================
// Tiered Photo Downloader — with retry & error resilience
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import type { OAuthService } from './oauth';
import type { DatabaseService } from './database';
import type { DownloadProgress } from '../../shared/types';
import { sleep } from '../../shared/utils';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

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

    // Security: Sanitize albumKey to prevent path traversal
    const safeAlbumKey = sanitizeFilename(albumKey);
    const thumbDir = path.join(this.dataDir, 'thumbnails', safeAlbumKey);
    ensureDir(thumbDir);

    for (let i = 0; i < toDownload.length; i += this.concurrentDownloads) {
      const batch = toDownload.slice(i, i + this.concurrentDownloads);

      await Promise.all(
        batch.map(async (img) => {
          const destPath = path.join(thumbDir, sanitizeFilename(img.filename));

          try {
            if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
              this.db.markThumbDownloaded(img.imageKey, destPath);
            } else {
              await downloadWithRetry(() => this.oauth.downloadFile(img.thumbUrl!, destPath), img.imageKey, 'thumb');
              this.db.markThumbDownloaded(img.imageKey, destPath);
            }
          } catch (err) {
            console.error(`[Downloader] Failed to download thumbnail for ${img.imageKey}:`, err);
            // Don't rethrow — continue with the rest of the batch
          }

          completed++;
          this.emitProgress(completed, total, img.filename, 'thumbnails');
        })
      );

      // Yield to event loop between batches
      await sleep(10);
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

    // Security: Sanitize albumKey to prevent path traversal
    const safeAlbumKey = sanitizeFilename(albumKey);
    const mediumDir = path.join(this.dataDir, 'medium', safeAlbumKey);
    ensureDir(mediumDir);

    for (let i = 0; i < toDownload.length; i += this.concurrentDownloads) {
      const batch = toDownload.slice(i, i + this.concurrentDownloads);

      await Promise.all(
        batch.map(async (img) => {
          const destPath = path.join(mediumDir, sanitizeFilename(img.filename));

          try {
            if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
              this.db.markMediumDownloaded(img.imageKey, destPath);
            } else {
              await downloadWithRetry(() => this.oauth.downloadFile(img.mediumUrl!, destPath), img.imageKey, 'medium');
              this.db.markMediumDownloaded(img.imageKey, destPath);
            }
          } catch (err) {
            console.error(`[Downloader] Failed to download medium for ${img.imageKey}:`, err);
          }

          completed++;
          this.emitProgress(completed, total, img.filename, 'medium');
        })
      );

      await sleep(10);
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

// -----------------------------------------------------------
// Module-level utilities
// -----------------------------------------------------------

async function downloadWithRetry(
  fn: () => Promise<void>,
  imageKey: string,
  type: string,
  retries = MAX_RETRIES
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const delay = RETRY_DELAY_MS * (attempt + 1);
        console.warn(`[Downloader] ${type} download failed for ${imageKey} (attempt ${attempt + 1}), retrying in ${delay}ms`);
        await sleep(delay);
      }
    }
  }
  throw lastErr;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Replace characters that are illegal in filesystem names */
function sanitizeFilename(filename: string): string {
  // eslint-disable-next-line no-control-regex
  return filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
}
