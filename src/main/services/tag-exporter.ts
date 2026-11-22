// ============================================================
// Local Tag Exporter Service — JSON Manifest, CSV, & XMP Sidecars
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseService } from './database';
import {
  formatPersonKeyword,
  type AppSettings,
  type KeywordFormatMode,
  type KeywordFormatOptions,
  type TagManifest,
  type TagManifestEntry,
  type TagManifestImageEntry,
} from '../../shared/types';

export const TAG_MANIFEST_SCHEMA_VERSION = 1;
export const CSV_HEADER =
  'album_title,album_key,filename,image_key,person_name,confidence,approved,uploaded,tagged_at,web_uri';

// -----------------------------------------------------------
// Security & Filesystem Helpers
// -----------------------------------------------------------

/** Sanitize a path segment to prevent path traversal and invalid filename characters. */
export function sanitizePathSegment(segment: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = segment.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
  if (!cleaned) return 'unknown';
  if (cleaned === '.' || cleaned === '..') {
    return `_${cleaned}`;
  }
  return cleaned;
}

export function ensureSecureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } else {
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      // Ignore chmod errors on systems that don't support it
    }
  }
}

function writeSecureFile(filePath: string, content: string): void {
  ensureSecureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, { encoding: 'utf-8', mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Ignore chmod errors on systems that don't support it
  }
}

// -----------------------------------------------------------
// JSON Manifest Serialization & Validation
// -----------------------------------------------------------

export function serializeTagManifest(
  images: Record<string, TagManifestImageEntry>,
  options: {
    keywordFormat: KeywordFormatMode;
    keywordPrefix: string;
    exportedAt?: string;
  }
): TagManifest {
  return {
    schemaVersion: TAG_MANIFEST_SCHEMA_VERSION,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    keywordFormat: options.keywordFormat,
    keywordPrefix: options.keywordPrefix,
    images,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateTagEntry(raw: unknown, imageKey: string): TagManifestEntry {
  if (!isPlainRecord(raw)) {
    throw new Error(`Invalid tag entry for image "${imageKey}"`);
  }
  if (typeof raw.personName !== 'string' || !raw.personName.trim()) {
    throw new Error(`Invalid personName for image "${imageKey}"`);
  }
  if (typeof raw.confidence !== 'number' || !Number.isFinite(raw.confidence)) {
    throw new Error(`Invalid confidence for image "${imageKey}"`);
  }
  if (!isPlainRecord(raw.bbox)) {
    throw new Error(`Invalid bbox for image "${imageKey}"`);
  }
  const { x, y, width, height } = raw.bbox;
  if (
    typeof x !== 'number' ||
    !Number.isFinite(x) ||
    typeof y !== 'number' ||
    !Number.isFinite(y) ||
    typeof width !== 'number' ||
    !Number.isFinite(width) ||
    typeof height !== 'number' ||
    !Number.isFinite(height)
  ) {
    throw new Error(`Invalid bbox coordinates for image "${imageKey}"`);
  }
  if (typeof raw.approved !== 'boolean' || typeof raw.uploaded !== 'boolean') {
    throw new Error(`Invalid approval or upload status for image "${imageKey}"`);
  }

  return {
    personName: raw.personName,
    confidence: raw.confidence,
    bbox: { x, y, width, height },
    approved: raw.approved,
    uploaded: raw.uploaded,
    taggedAt: typeof raw.taggedAt === 'string' ? raw.taggedAt : '',
  };
}

export function parseTagManifest(rawJson: string): TagManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    throw new Error(`Invalid JSON manifest: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!isPlainRecord(parsed)) {
    throw new Error('Invalid manifest: expected JSON object');
  }

  if (parsed.schemaVersion !== TAG_MANIFEST_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported manifest schemaVersion: ${String(parsed.schemaVersion)}`
    );
  }

  if (!isPlainRecord(parsed.images)) {
    throw new Error('Invalid manifest: expected "images" object');
  }

  const images: Record<string, TagManifestImageEntry> = {};
  for (const [key, rawImg] of Object.entries(parsed.images)) {
    if (!isPlainRecord(rawImg) || !Array.isArray(rawImg.tags)) {
      throw new Error(`Invalid image entry "${key}" in manifest`);
    }

    const imageKey = typeof rawImg.imageKey === 'string' && rawImg.imageKey ? rawImg.imageKey : key;
    images[imageKey] = {
      imageKey,
      albumKey: typeof rawImg.albumKey === 'string' ? rawImg.albumKey : '',
      albumTitle: typeof rawImg.albumTitle === 'string' ? rawImg.albumTitle : '',
      filename: typeof rawImg.filename === 'string' ? rawImg.filename : imageKey,
      webUri: typeof rawImg.webUri === 'string' ? rawImg.webUri : '',
      tags: rawImg.tags.map(t => validateTagEntry(t, imageKey)),
    };
  }

  const keywordFormat: KeywordFormatMode =
    parsed.keywordFormat === 'plain' ? 'plain' : 'prefixed';
  const keywordPrefix =
    typeof parsed.keywordPrefix === 'string' ? parsed.keywordPrefix : 'Person:';

  return {
    schemaVersion: TAG_MANIFEST_SCHEMA_VERSION,
    exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : '',
    keywordFormat,
    keywordPrefix,
    images,
  };
}

export function writeTagManifest(filePath: string, manifest: TagManifest): void {
  writeSecureFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`);
}

export function readTagManifest(filePath: string): TagManifest {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return parseTagManifest(raw);
}

// -----------------------------------------------------------
// CSV Export
// -----------------------------------------------------------

export function escapeCsvCell(value: string): string {
  if (
    value.includes(',') ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r')
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function serializeTagsToCsv(images: Record<string, TagManifestImageEntry>): string {
  const lines = [CSV_HEADER];

  for (const img of Object.values(images)) {
    for (const tag of img.tags) {
      lines.push(
        [
          img.albumTitle,
          img.albumKey,
          img.filename,
          img.imageKey,
          tag.personName,
          String(tag.confidence),
          String(tag.approved),
          String(tag.uploaded),
          tag.taggedAt,
          img.webUri,
        ]
          .map(escapeCsvCell)
          .join(',')
      );
    }
  }

  return `${lines.join('\n')}\n`;
}

export function exportTagsToCsv(
  filePath: string,
  images: Record<string, TagManifestImageEntry>
): number {
  let rowCount = 0;
  for (const img of Object.values(images)) {
    rowCount += img.tags.length;
  }
  writeSecureFile(filePath, serializeTagsToCsv(images));
  return rowCount;
}

// -----------------------------------------------------------
// XMP Sidecar Export (dc:subject + MWG Face Regions)
// -----------------------------------------------------------

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function serializeImageToXmp(
  image: TagManifestImageEntry,
  options?: KeywordFormatOptions
): string {
  const seenSubjects = new Set<string>();
  const subjectLines: string[] = [];
  for (const tag of image.tags) {
    const keyword = formatPersonKeyword(tag.personName, options);
    if (keyword && !seenSubjects.has(keyword)) {
      seenSubjects.add(keyword);
      subjectLines.push(`        <rdf:li>${escapeXml(keyword)}</rdf:li>`);
    }
  }

  const regionBlocks = image.tags
    .map(tag => {
      const centerX = (tag.bbox.x + tag.bbox.width / 2).toFixed(4);
      const centerY = (tag.bbox.y + tag.bbox.height / 2).toFixed(4);
      const w = tag.bbox.width.toFixed(4);
      const h = tag.bbox.height.toFixed(4);
      return `          <rdf:li rdf:parseType="Resource">
            <mwg-rs:Name>${escapeXml(tag.personName)}</mwg-rs:Name>
            <mwg-rs:Type>Face</mwg-rs:Type>
            <mwg-rs:Area rdf:parseType="Resource">
              <stArea:x>${centerX}</stArea:x>
              <stArea:y>${centerY}</stArea:y>
              <stArea:w>${w}</stArea:w>
              <stArea:h>${h}</stArea:h>
              <stArea:unit>normalized</stArea:unit>
            </mwg-rs:Area>
          </rdf:li>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:mwg-rs="http://www.metadataworkinggroup.com/schemas/regions/"
      xmlns:stArea="http://ns.adobe.com/xmp/sType/Area#">
      <dc:subject>
        <rdf:Bag>
${subjectLines.join('\n')}
        </rdf:Bag>
      </dc:subject>
      <mwg-rs:Regions rdf:parseType="Resource">
        <mwg-rs:RegionList>
          <rdf:Bag>
${regionBlocks}
          </rdf:Bag>
        </mwg-rs:RegionList>
      </mwg-rs:Regions>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
`;
}

export function exportTagsToXmp(
  targetDir: string,
  images: Record<string, TagManifestImageEntry>,
  options?: KeywordFormatOptions & { organizeByAlbum?: boolean }
): string[] {
  ensureSecureDir(targetDir);
  const writtenPaths: string[] = [];
  const organizeByAlbum = options?.organizeByAlbum !== false;

  for (const img of Object.values(images)) {
    if (img.tags.length === 0) continue;

    const safeFilename = sanitizePathSegment(img.filename || img.imageKey);
    const destDir =
      organizeByAlbum && img.albumKey
        ? path.join(targetDir, sanitizePathSegment(img.albumKey))
        : targetDir;
    const xmpPath = path.join(destDir, `${safeFilename}.xmp`);

    writeSecureFile(xmpPath, serializeImageToXmp(img, options));
    writtenPaths.push(xmpPath);
  }

  return writtenPaths;
}

// -----------------------------------------------------------
// Service Class
// -----------------------------------------------------------

export class TagExporterService {
  private db: DatabaseService;
  private dataDir: string;
  private getSettings: () => AppSettings;

  constructor(db: DatabaseService, dataDir: string, getSettings: () => AppSettings) {
    this.db = db;
    this.dataDir = dataDir;
    this.getSettings = getSettings;
  }

  getDefaultManifestPath(): string {
    return path.join(this.dataDir, 'tags.json');
  }

  getDefaultCsvPath(): string {
    return path.join(this.dataDir, 'exports', 'smugmug_tags.csv');
  }

  getDefaultXmpDir(): string {
    return path.join(this.dataDir, 'exports', 'xmp');
  }

  /** Syncs the auto-saved tags.json manifest if enabled in AppSettings. */
  syncManifestIfEnabled(): void {
    const settings = this.getSettings();
    if (!settings.autoSaveTagManifest) return;

    try {
      const images = this.db.getAllExportableImageTags();
      const manifest = serializeTagManifest(images, {
        keywordFormat: settings.keywordFormat,
        keywordPrefix: settings.keywordPrefix,
      });
      writeTagManifest(this.getDefaultManifestPath(), manifest);
    } catch (err) {
      console.warn('[TagExporter] Failed to auto-save tags.json manifest:', err);
    }
  }

  exportManifest(targetPath: string): { filePath: string; imageCount: number; tagCount: number } {
    const settings = this.getSettings();
    const images = this.db.getAllExportableImageTags();
    const manifest = serializeTagManifest(images, {
      keywordFormat: settings.keywordFormat,
      keywordPrefix: settings.keywordPrefix,
    });
    writeTagManifest(targetPath, manifest);

    const imageEntries = Object.values(images);
    const tagCount = imageEntries.reduce((sum, img) => sum + img.tags.length, 0);
    return {
      filePath: targetPath,
      imageCount: imageEntries.length,
      tagCount,
    };
  }

  importManifest(sourcePath: string): { filePath: string; importedCount: number; skippedCount: number } {
    const manifest = readTagManifest(sourcePath);
    const { importedCount, skippedCount } = this.db.restoreImageTagsFromManifest(manifest.images);
    return {
      filePath: sourcePath,
      importedCount,
      skippedCount,
    };
  }

  exportCsv(targetPath: string): { filePath: string; tagCount: number } {
    const images = this.db.getAllExportableImageTags();
    const tagCount = exportTagsToCsv(targetPath, images);
    return {
      filePath: targetPath,
      tagCount,
    };
  }

  exportXmp(targetDir: string, albumKey?: string): { directory: string; filesWritten: number } {
    const settings = this.getSettings();
    const images = this.db.getAllExportableImageTags(albumKey);
    const paths = exportTagsToXmp(targetDir, images, {
      mode: settings.keywordFormat,
      prefix: settings.keywordPrefix,
      organizeByAlbum: true,
    });
    return {
      directory: targetDir,
      filesWritten: paths.length,
    };
  }
}
