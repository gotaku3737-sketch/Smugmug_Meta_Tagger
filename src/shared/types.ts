// ============================================================
// SmugMug Face Tagger — Shared Type Definitions
// ============================================================

// -----------------------------------------------------------
// SmugMug API Types
// -----------------------------------------------------------

export interface SmugMugUser {
  nickname: string;
  displayName: string;
  imageUrl?: string;
}

export interface SmugMugAlbum {
  albumKey: string;
  title: string;
  imageCount: number;
  coverImageUrl?: string;
  webUri?: string;
  lastUpdated?: string;
}

export interface SmugMugImage {
  imageKey: string;
  albumKey: string;
  filename: string;
  title?: string;
  caption?: string;
  keywords: string;
  thumbUrl?: string;
  mediumUrl?: string;
  originalUrl?: string;
  webUri?: string;
}

export interface ImageSizeDetails {
  thumbUrl: string;    // ~150px
  mediumUrl: string;   // ~800px
  originalUrl: string; // full resolution
}

// -----------------------------------------------------------
// OAuth Types
// -----------------------------------------------------------

export interface OAuthTokens {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

export interface OAuthRequestToken {
  token: string;
  tokenSecret: string;
  authorizationUrl: string;
}

export type AuthStatus =
  | { state: 'disconnected' }
  | { state: 'awaiting-verifier'; authorizationUrl: string }
  | { state: 'connected'; user: SmugMugUser };

// -----------------------------------------------------------
// Database / Local State Types
// -----------------------------------------------------------

export interface Person {
  id: number;
  name: string;
  descriptorCount: number;
  createdAt: string;
}

export interface FaceDescriptor {
  id: number;
  personId: number;
  descriptor: Float32Array;
  sourceImageKey: string;
  bbox: BoundingBox;
  createdAt: string;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectedFace {
  bbox: BoundingBox;
  descriptor: Float32Array;
  landmarks?: number[][];
}

export interface FaceMatch {
  personName: string;
  distance: number;
  confidence: number;
  bbox: BoundingBox;
}

export interface ImageRecord {
  id: number;
  imageKey: string;
  albumKey: string;
  filename: string;
  thumbPath?: string;
  mediumPath?: string;
  thumbUrl?: string;
  mediumUrl?: string;
  originalUrl?: string;
  thumbDownloaded: boolean;
  mediumDownloaded: boolean;
  facesDetected: boolean;
  faceCount: number;
  tagsUploaded: boolean;
  existingKeywords?: string;
  detectedPeople?: FaceMatch[];
  createdAt: string;
}

export interface AlbumRecord {
  id: number;
  albumKey: string;
  title: string;
  imageCount: number;
  coverImageUrl?: string;
  thumbsDownloaded: boolean;
  syncedAt?: string;
}

// -----------------------------------------------------------
// Progress / Events
// -----------------------------------------------------------

export interface DownloadProgress {
  completed: number;
  total: number;
  currentFile?: string;
  bytesPerSecond?: number;
  phase: 'thumbnails' | 'medium' | 'original';
}

export interface FaceDetectionProgress {
  completed: number;
  total: number;
  currentImage?: string;
  facesFound: number;
}

export interface TagUploadProgress {
  completed: number;
  total: number;
  currentImage?: string;
}

// -----------------------------------------------------------
// Database Statistics
// -----------------------------------------------------------

export interface DatabaseStats {
  albumCount: number;
  imageCount: number;
  downloadedThumbs: number;
  downloadedMedium: number;
  facesDetected: number;
  peopleCount: number;
  descriptorCount: number;
  taggedImages: number;
}

// -----------------------------------------------------------
// Settings
// -----------------------------------------------------------

export interface AppSettings {
  recognitionThreshold: number; // 0.4 - 0.8, default 0.6
  concurrentDownloads: number;  // default 5
  dataDirectory: string;
}

// -----------------------------------------------------------
// IPC API (exposed to renderer via contextBridge)
// -----------------------------------------------------------

export interface ElectronAPI {
  // OAuth
  smugmug: {
    setCredentials(consumerKey: string, consumerSecret: string): Promise<void>;
    startAuth(): Promise<OAuthRequestToken>;
    completeAuth(verifier: string): Promise<SmugMugUser>;
    getAuthStatus(): Promise<AuthStatus>;
    disconnect(): Promise<void>;
  };

  // Albums & Images
  albums: {
    sync(): Promise<AlbumRecord[]>;
    getAll(): Promise<AlbumRecord[]>;
    getImages(albumKey: string): Promise<ImageRecord[]>;
  };

  // Downloads
  photos: {
    downloadThumbnails(albumKey: string): Promise<void>;
    downloadMedium(albumKey: string): Promise<void>;
    onDownloadProgress(callback: (progress: DownloadProgress) => void): () => void;
  };

  // Face Detection & Training
  faces: {
    detectInAlbum(albumKey: string): Promise<void>;
    trainFace(imageKey: string, bbox: BoundingBox, personName: string): Promise<void>;
    getPeople(): Promise<Person[]>;
    deletePerson(personId: number): Promise<void>;
    onDetectionProgress(callback: (progress: FaceDetectionProgress) => void): () => void;
  };

  // Auto-tagging
  tags: {
    runAutoTagger(): Promise<void>;
    getUntaggedResults(): Promise<ImageRecord[]>;
    approveMatches(imageKey: string, approvedNames: string[]): Promise<void>;
    uploadTags(imageKeys: string[]): Promise<void>;
    onUploadProgress(callback: (progress: TagUploadProgress) => void): () => void;
  };

  // Settings & Stats
  settings: {
    get(): Promise<AppSettings>;
    update(settings: Partial<AppSettings>): Promise<void>;
    getStats(): Promise<DatabaseStats>;
    clearTrainingData(): Promise<void>;
    resetDatabase(): Promise<void>;
  };

  // Utils
  util: {
    openExternal(url: string): Promise<void>;
  };
}

// -----------------------------------------------------------
// Keyword Helpers
// -----------------------------------------------------------

export const PERSON_PREFIX = 'Person:';

export function formatPersonKeyword(name: string): string {
  return `${PERSON_PREFIX}${name}`;
}

export function parsePersonKeywords(keywords: string): string[] {
  if (!keywords) return [];
  return keywords
    .split(';')
    .map(k => k.trim())
    .filter(k => k.startsWith(PERSON_PREFIX))
    .map(k => k.slice(PERSON_PREFIX.length));
}

export function mergeKeywords(existingKeywords: string, personNames: string[]): string {
  const existing = existingKeywords
    ? existingKeywords.split(';').map(k => k.trim()).filter(Boolean)
    : [];

  // Remove any old Person: tags that are being replaced
  const nonPersonTags = existing.filter(k => !k.startsWith(PERSON_PREFIX));
  const newPersonTags = personNames.map(formatPersonKeyword);

  return [...nonPersonTags, ...newPersonTags].join('; ');
}
