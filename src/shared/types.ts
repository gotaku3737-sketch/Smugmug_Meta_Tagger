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

export type AlbumPrivacy = 'Public' | 'Unlisted' | 'Private' | 'Unknown';

export interface SmugMugAlbum {
  albumKey: string;
  title: string;
  imageCount: number;
  coverImageUrl?: string;
  privacy?: AlbumPrivacy;
  localOnly?: boolean;
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
  localOnly?: boolean;
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

export interface ImageTagRow {
  id: number;
  imageKey: string;
  personName: string;
  confidence: number;
  bboxX: number;
  bboxY: number;
  bboxW: number;
  bboxH: number;
  approved: number;  // 0 = auto-detected, 1 = manually approved
  uploaded: number;  // 0 = pending, 1 = pushed to SmugMug
  taggedAt: string;
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
  webUri?: string;
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
  privacy?: AlbumPrivacy;
  localOnly?: boolean;
  thumbsDownloaded: boolean;
  syncedAt?: string;
}

export interface KeywordDiffPreview {
  imageKey: string;
  filename: string;
  albumKey: string;
  albumTitle: string;
  albumPrivacy: AlbumPrivacy;
  beforeKeywords: string;
  afterKeywords: string;
  localOnly: boolean;
  skippedPeople: string[];
}

export interface UploadTagsResult {
  uploaded: number;
  skippedPublic: number;
  skippedLocalOnly: number;
  skippedUnapproved: number;
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

export type KeywordFormatMode = 'prefixed' | 'plain';

export interface KeywordFormatOptions {
  mode?: KeywordFormatMode;       // default 'prefixed'
  prefix?: string;                // default PERSON_PREFIX ('Person:')
  previousPersonNames?: string[]; // optional known names to replace in 'plain' mode
}

export interface AppSettings {
  recognitionThreshold: number;     // 0.4 - 0.8, default 0.6
  concurrentDownloads: number;      // default 5
  dataDirectory: string;
  keywordFormat: KeywordFormatMode; // default 'prefixed'
  keywordPrefix: string;            // default 'Person:'
  autoSaveTagManifest: boolean;     // default true
  autoPurgeMediumCache: boolean;    // default false
  allowPublicUploads: boolean;      // default false
}

// -----------------------------------------------------------
// Local Tag Manifest & Export Types
// -----------------------------------------------------------

export interface TagManifestEntry {
  personName: string;
  confidence: number;
  bbox: BoundingBox;
  approved: boolean;
  uploaded: boolean;
  taggedAt: string;
}

export interface TagManifestImageEntry {
  imageKey: string;
  albumKey: string;
  albumTitle: string;
  filename: string;
  webUri: string;
  tags: TagManifestEntry[];
}

export interface TagManifest {
  schemaVersion: number;
  exportedAt: string;
  keywordFormat: KeywordFormatMode;
  keywordPrefix: string;
  images: Record<string, TagManifestImageEntry>;
}

export interface TagExportResult {
  canceled: boolean;
  filePath?: string;
  count: number;
}

export interface TagImportResult {
  canceled: boolean;
  filePath?: string;
  importedCount: number;
  skippedCount: number;
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
    disconnect(clearConsumerKeys?: boolean): Promise<void>;
  };

  // Albums & Images
  albums: {
    sync(): Promise<AlbumRecord[]>;
    getAll(): Promise<AlbumRecord[]>;
    getImages(albumKey: string): Promise<ImageRecord[]>;
    refreshImages(albumKey: string): Promise<ImageRecord[]>;
    setLocalOnly(albumKey: string, localOnly: boolean): Promise<void>;
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
    setPersonLocalOnly(personId: number, localOnly: boolean): Promise<void>;
    forgetPerson(personId: number, removeFromSmugMug?: boolean): Promise<{ removedLocal: number; removedRemote: number }>;
    onDetectionProgress(callback: (progress: FaceDetectionProgress) => void): () => void;
  };

  // Auto-tagging & Exports
  tags: {
    runAutoTagger(): Promise<void>;
    getUntaggedResults(): Promise<ImageRecord[]>;
    approveMatches(imageKey: string, approvedNames: string[]): Promise<void>;
    previewUpload(imageKeys: string[]): Promise<KeywordDiffPreview[]>;
    uploadTags(imageKeys: string[], options?: { allowPublic?: boolean }): Promise<UploadTagsResult>;
    exportManifest(): Promise<TagExportResult>;
    importManifest(): Promise<TagImportResult>;
    exportCsv(): Promise<TagExportResult>;
    exportXmp(albumKey?: string): Promise<TagExportResult>;
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

/** Strip semicolons (SmugMug keyword delimiter) and whitespace, falling back to PERSON_PREFIX if empty. */
export function sanitizeKeywordPrefix(prefix?: string): string {
  if (prefix === undefined) return PERSON_PREFIX;
  const cleaned = prefix.replace(/;/g, '').trim();
  return cleaned || PERSON_PREFIX;
}

function resolvePrefix(options?: KeywordFormatOptions): string {
  if (options?.mode === 'plain') return '';
  return sanitizeKeywordPrefix(options?.prefix);
}

export function formatPersonKeyword(name: string, options?: KeywordFormatOptions): string {
  const trimmed = name.trim();
  const prefix = resolvePrefix(options);
  return prefix ? `${prefix}${trimmed}` : trimmed;
}

export function parsePersonKeywords(keywords: string, options?: KeywordFormatOptions): string[] {
  if (!keywords) return [];
  const tokens = keywords
    .split(';')
    .map(k => k.trim())
    .filter(Boolean);

  if (options?.mode === 'plain') {
    const known = options.previousPersonNames
      ?.map(n => n.trim().toLowerCase())
      .filter(Boolean);
    if (known && known.length > 0) {
      const knownSet = new Set(known);
      return tokens.filter(k => knownSet.has(k.toLowerCase()));
    }
    return tokens;
  }

  const prefix = resolvePrefix(options);
  return tokens
    .filter(k => k.startsWith(prefix))
    .map(k => k.slice(prefix.length).trim())
    .filter(Boolean);
}

export function mergeKeywords(
  existingKeywords: string,
  personNames: string[],
  options?: KeywordFormatOptions
): string {
  const existing = existingKeywords
    ? existingKeywords.split(';').map(k => k.trim()).filter(Boolean)
    : [];

  // Deduplicate incoming person names case-insensitively while preserving first occurrence
  const seenNames = new Set<string>();
  const uniqueNames: string[] = [];
  for (const rawName of personNames) {
    const trimmed = rawName.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seenNames.has(key)) {
      seenNames.add(key);
      uniqueNames.push(trimmed);
    }
  }

  if (options?.mode === 'plain') {
    const replaceSet = new Set<string>();
    for (const name of uniqueNames) {
      replaceSet.add(name.toLowerCase());
    }
    for (const prev of options.previousPersonNames ?? []) {
      const trimmedPrev = prev.trim();
      if (trimmedPrev) {
        replaceSet.add(trimmedPrev.toLowerCase());
      }
    }

    const nonPersonTags = existing.filter(k => !replaceSet.has(k.toLowerCase()));
    return [...nonPersonTags, ...uniqueNames].join('; ');
  }

  const prefix = resolvePrefix(options);
  // Remove any old person tags matching the active prefix
  const nonPersonTags = existing.filter(k => !k.startsWith(prefix));
  const newPersonTags = uniqueNames.map(name => `${prefix}${name}`);

  return [...nonPersonTags, ...newPersonTags].join('; ');
}

/** Remove a single person's formatted keyword from an existing SmugMug keyword string. */
export function removePersonKeyword(
  existingKeywords: string,
  personName: string,
  options?: KeywordFormatOptions
): { keywords: string; removed: boolean } {
  const existing = existingKeywords
    ? existingKeywords.split(';').map(k => k.trim()).filter(Boolean)
    : [];

  const target = formatPersonKeyword(personName, options).toLowerCase();
  if (!target) {
    return { keywords: existing.join('; '), removed: false };
  }

  let removed = false;
  const remaining = existing.filter(k => {
    if (k.toLowerCase() === target) {
      removed = true;
      return false;
    }
    return true;
  });

  return { keywords: remaining.join('; '), removed };
}
