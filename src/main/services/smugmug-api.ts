// ============================================================
// SmugMug API v2 Client
// ============================================================

import type { OAuthService } from './oauth';
import type { SmugMugAlbum, SmugMugImage } from '../../shared/types';

const API_BASE = 'https://api.smugmug.com';

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

    const data = await this.oauth.signedGet(`${API_BASE}/api/v2!authuser`) as {
      Response: { User: { NickName: string } };
    };
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
    const count = 100; // Max per page
    let hasMore = true;

    while (hasMore) {
      const data = await this.oauth.signedGet(
        `${API_BASE}/api/v2/user/${nickname}!albums?start=${start}&count=${count}&_expand=HighlightImage`
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
      const data = await this.oauth.signedGet(
        `${API_BASE}/api/v2/album/${albumKey}!images?start=${start}&count=${count}&_expand=ImageSizeDetails`
      ) as {
        Response: {
          AlbumImage?: ApiImage[];
          Pages?: PageInfo;
        };
      };

      const apiImages = data.Response.AlbumImage || [];

      for (const img of apiImages) {
        const sizes = await this.getImageSizes(img);

        images.push({
          imageKey: img.ImageKey,
          albumKey,
          filename: img.FileName,
          title: img.Title,
          caption: img.Caption,
          keywords: img.Keywords || '',
          thumbUrl: sizes.thumbUrl,
          mediumUrl: sizes.mediumUrl,
          originalUrl: sizes.originalUrl,
          webUri: img.WebUri,
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
    // Try to get sizes from expanded data or via separate request
    let sizesUri = img.Uris?.ImageSizeDetails?.Uri || img.Uris?.ImageSizes?.Uri;

    if (!sizesUri) {
      // Construct the URI manually
      sizesUri = `/api/v2/image/${img.ImageKey}!sizedetails`;
    }

    try {
      const data = await this.oauth.signedGet(`${API_BASE}${sizesUri}`) as {
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
      console.warn(`Failed to get sizes for image ${img.ImageKey}:`, err);
    }

    // Fallback to thumbnail if available
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
    await this.oauth.signedPatch(
      `${API_BASE}/api/v2/image/${imageKey}`,
      { Keywords: keywords }
    );
  }
}
