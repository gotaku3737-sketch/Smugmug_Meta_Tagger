// ============================================================
// SmugMug API v2 Client — with retry & rate-limit handling
// ============================================================

import type { OAuthService } from './oauth';
import type { SmugMugAlbum, SmugMugImage } from '../../shared/types';

const API_BASE = 'https://api.smugmug.com';

/** Max retries for transient failures (429, 5xx, network errors) */
const MAX_RETRIES = 5;
/** Base delay for exponential backoff (ms) */
const BASE_DELAY_MS = 1000;

interface ApiAlbum {
  AlbumKey: string;
  Name: string;
  Title: string;
  ImageCount: number;
  Uris: {
    AlbumImages?: { Uri: string };
    HighlightImage?: { Uri: string };
  };
  WebUri?: string;
  LastUpdated?: string;
}

interface ApiImage {
  ImageKey: string;
  FileName: string;
  Title?: string;
  Caption?: string;
  Keywords?: string;
  Uris: {
    ImageSizeDetails?: { Uri: string };
    ImageSizes?: { Uri: string };
  };
  WebUri?: string;
  ThumbnailUrl?: string;
}

interface PageInfo {
  TotalPages: number;
  Total: number;
  Start: number;
  Count: number;
}

export class SmugMugAPI {
  private oauth: OAuthService;
  private nickname: string | null = null;

  constructor(oauth: OAuthService) {
    this.oauth = oauth;
  }

  // -----------------------------------------------------------
  // User
  // -----------------------------------------------------------

  async getNickname(): Promise<string> {
    if (this.nickname) return this.nickname;

    const data = await this.requestWithRetry(() =>
      this.oauth.signedGet(`${API_BASE}/api/v2!authuser`)
    ) as { Response: { User: { NickName: string } } };

    this.nickname = data.Response.User.NickName;
    return this.nickname;
  }

  // -----------------------------------------------------------
  // Albums
  // -----------------------------------------------------------

  async getAlbums(): Promise<SmugMugAlbum[]> {
    const nickname = await this.getNickname();
    const albums: SmugMugAlbum[] = [];

    let start = 1;
    const count = 100;
    let hasMore = true;

    while (hasMore) {
      const data = await this.requestWithRetry(() =>
        this.oauth.signedGet(
          `${API_BASE}/api/v2/user/${nickname}!albums?start=${start}&count=${count}&_expand=HighlightImage`
        )
      ) as {
        Response: {
          Album?: ApiAlbum[];
          Pages?: PageInfo;
        };
      };

      const apiAlbums = data.Response.Album || [];

      for (const a of apiAlbums) {
        albums.push({
          albumKey: a.AlbumKey,
          title: a.Title || a.Name,
          imageCount: a.ImageCount,
          webUri: a.WebUri,
          lastUpdated: a.LastUpdated,
        });
      }

      const pages = data.Response.Pages;
      if (pages && start + count <= pages.Total) {
        start += count;
      } else {
        hasMore = false;
      }
    }

    return albums;
  }

  // -----------------------------------------------------------
  // Images in Album
  // -----------------------------------------------------------

  async getAlbumImages(albumKey: string): Promise<SmugMugImage[]> {
    const images: SmugMugImage[] = [];

    let start = 1;
    const count = 100;
    let hasMore = true;

    while (hasMore) {
      const data = await this.requestWithRetry(() =>
        this.oauth.signedGet(
          `${API_BASE}/api/v2/album/${albumKey}!images?start=${start}&count=${count}&_expand=ImageSizeDetails`
        )
      ) as {
        Response: {
          AlbumImage?: ApiImage[];
          Pages?: PageInfo;
        };
      };

      const apiImages = data.Response.AlbumImage || [];

      // Fetch image sizes in parallel (up to 10 at a time) to avoid serial bottleneck
      const CHUNK = 10;
      for (let i = 0; i < apiImages.length; i += CHUNK) {
        const chunk = apiImages.slice(i, i + CHUNK);
        const sizes = await Promise.all(chunk.map(img => this.getImageSizes(img)));

        chunk.forEach((img, idx) => {
          images.push({
            imageKey: img.ImageKey,
            albumKey,
            filename: img.FileName,
            title: img.Title,
            caption: img.Caption,
            keywords: img.Keywords || '',
            thumbUrl: sizes[idx].thumbUrl,
            mediumUrl: sizes[idx].mediumUrl,
            originalUrl: sizes[idx].originalUrl,
            webUri: img.WebUri,
          });
        });
      }

      const pages = data.Response.Pages;
      if (pages && start + count <= pages.Total) {
        start += count;
      } else {
        hasMore = false;
      }
    }

    return images;
  }

  // -----------------------------------------------------------
  // Image Sizes
  // -----------------------------------------------------------

  private async getImageSizes(img: ApiImage): Promise<{
    thumbUrl: string;
    mediumUrl: string;
    originalUrl: string;
  }> {
    let sizesUri = img.Uris?.ImageSizeDetails?.Uri || img.Uris?.ImageSizes?.Uri;

    if (!sizesUri) {
      sizesUri = `/api/v2/image/${img.ImageKey}!sizedetails`;
    }

    try {
      const data = await this.requestWithRetry(() =>
        this.oauth.signedGet(`${API_BASE}${sizesUri}`)
      ) as {
        Response: {
          ImageSizeDetails?: Record<string, { Url: string; Width: number; Height: number }>;
          ImageSizes?: {
            ThumbnailUrl?: string;
            MediumUrl?: string;
            LargestUrl?: string;
            OriginalUrl?: string;
          };
        };
      };

      if (data.Response.ImageSizeDetails) {
        const sizes = data.Response.ImageSizeDetails;
        return {
          thumbUrl: sizes.ThumbnailUrl?.Url || sizes.ThumbUrl?.Url || sizes.TinyUrl?.Url || '',
          mediumUrl: sizes.MediumUrl?.Url || sizes.LargeUrl?.Url || sizes['800Url']?.Url || '',
          originalUrl: sizes.OriginalUrl?.Url || sizes.X5LargeUrl?.Url || sizes.X4LargeUrl?.Url || '',
        };
      }

      if (data.Response.ImageSizes) {
        const sizes = data.Response.ImageSizes;
        return {
          thumbUrl: sizes.ThumbnailUrl || '',
          mediumUrl: sizes.MediumUrl || '',
          originalUrl: sizes.OriginalUrl || sizes.LargestUrl || '',
        };
      }
    } catch (err) {
      console.warn(`[SmugMugAPI] Failed to get sizes for image ${img.ImageKey}:`, err);
    }

    return {
      thumbUrl: img.ThumbnailUrl || '',
      mediumUrl: '',
      originalUrl: '',
    };
  }

  // -----------------------------------------------------------
  // Update Keywords
  // -----------------------------------------------------------

  async updateImageKeywords(imageKey: string, keywords: string): Promise<void> {
    await this.requestWithRetry(() =>
      this.oauth.signedPatch(
        `${API_BASE}/api/v2/image/${imageKey}`,
        { Keywords: keywords }
      )
    );
  }

  // -----------------------------------------------------------
  // Retry Helper — exponential backoff, respects 429 Retry-After
  // -----------------------------------------------------------

  private async requestWithRetry<T>(
    fn: () => Promise<T>,
    retries = MAX_RETRIES
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;

        const message = err instanceof Error ? err.message : String(err);

        // Parse HTTP status from error message (format: "HTTP 429: ...")
        const statusMatch = message.match(/HTTP (\d+)/);
        const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;

        // Don't retry on client errors except 429 (rate limit)
        if (status >= 400 && status < 500 && status !== 429) {
          console.error(`[SmugMugAPI] Non-retryable error (${status}):`, message);
          throw err;
        }

        if (attempt < retries) {
          // For 429, honour a Retry-After hint of 10s; otherwise use exponential backoff
          const delayMs = status === 429
            ? 10_000
            : BASE_DELAY_MS * Math.pow(2, attempt);

          console.warn(
            `[SmugMugAPI] Request failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${delayMs}ms. Error: ${message}`
          );

          await sleep(delayMs);
        }
      }
    }

    throw lastError;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
