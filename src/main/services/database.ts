// ============================================================
// SQLite Database Service (better-sqlite3)
// ============================================================

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import type {
  Person,
  AlbumPrivacy,
  AlbumRecord,
  ImageRecord,
  DetectedFace,
  FaceMatch,
  ImageTagRow,
  DatabaseStats,
  BoundingBox,
  TagManifestImageEntry,
} from '../../shared/types';

export class DatabaseService {
  private db: Database.Database;

  constructor(dataDir: string) {
    const dbDir = dataDir;
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true, mode: 0o700 });
    } else {
      try {
        fs.chmodSync(dbDir, 0o700);
      } catch (e) {
        // Ignore chmod errors on systems that don't support it
      }
    }

    const dbPath = path.join(dbDir, 'smugmug_tagger.db');
    this.db = new Database(dbPath);
    try {
      fs.chmodSync(dbPath, 0o600);
    } catch (e) {
      // Ignore chmod errors on systems that don't support it
    }

    // Enable WAL mode for better concurrent read performance
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.initSchema();
  }

  // -----------------------------------------------------------
  // Schema
  // -----------------------------------------------------------

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS people (
        id INTEGER PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        local_only INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS face_descriptors (
        id INTEGER PRIMARY KEY,
        person_id INTEGER REFERENCES people(id) ON DELETE CASCADE,
        descriptor BLOB NOT NULL,
        source_image_key TEXT NOT NULL,
        bbox_x REAL, bbox_y REAL,
        bbox_w REAL, bbox_h REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS albums (
        id INTEGER PRIMARY KEY,
        album_key TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        image_count INTEGER DEFAULT 0,
        cover_image_url TEXT,
        privacy TEXT DEFAULT 'Unknown',
        local_only INTEGER DEFAULT 0,
        thumbs_downloaded INTEGER DEFAULT 0,
        synced_at DATETIME
      );

      CREATE TABLE IF NOT EXISTS images (
        id INTEGER PRIMARY KEY,
        image_key TEXT UNIQUE NOT NULL,
        album_key TEXT REFERENCES albums(album_key),
        filename TEXT,
        thumb_path TEXT,
        medium_path TEXT,
        thumb_url TEXT,
        medium_url TEXT,
        original_url TEXT,
        web_uri TEXT,
        thumb_downloaded INTEGER DEFAULT 0,
        medium_downloaded INTEGER DEFAULT 0,
        faces_detected INTEGER DEFAULT 0,
        face_count INTEGER DEFAULT 0,
        tags_uploaded INTEGER DEFAULT 0,
        existing_keywords TEXT,
        detected_people TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_images_album ON images(album_key);
      CREATE INDEX IF NOT EXISTS idx_images_faces ON images(faces_detected);
      CREATE INDEX IF NOT EXISTS idx_images_tags ON images(tags_uploaded);
      CREATE INDEX IF NOT EXISTS idx_face_descriptors_person ON face_descriptors(person_id);

      CREATE TABLE IF NOT EXISTS image_tags (
        id INTEGER PRIMARY KEY,
        image_key TEXT NOT NULL REFERENCES images(image_key) ON DELETE CASCADE,
        person_name TEXT NOT NULL,
        confidence REAL,
        bbox_x REAL, bbox_y REAL,
        bbox_w REAL, bbox_h REAL,
        approved INTEGER DEFAULT 0,
        uploaded INTEGER DEFAULT 0,
        tagged_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_image_tags_image ON image_tags(image_key);
      CREATE INDEX IF NOT EXISTS idx_image_tags_person ON image_tags(person_name);
      CREATE INDEX IF NOT EXISTS idx_image_tags_uploaded ON image_tags(uploaded);

      CREATE TABLE IF NOT EXISTS detected_faces (
        id INTEGER PRIMARY KEY,
        image_key TEXT NOT NULL REFERENCES images(image_key) ON DELETE CASCADE,
        descriptor BLOB NOT NULL,
        bbox_x REAL, bbox_y REAL,
        bbox_w REAL, bbox_h REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_detected_faces_image ON detected_faces(image_key);
    `);

    const imageCols = this.db.prepare('PRAGMA table_info(images)').all() as { name: string }[];
    if (!imageCols.some(c => c.name === 'web_uri')) {
      this.db.exec('ALTER TABLE images ADD COLUMN web_uri TEXT');
    }

    const albumCols = this.db.prepare('PRAGMA table_info(albums)').all() as { name: string }[];
    if (!albumCols.some(c => c.name === 'privacy')) {
      this.db.exec("ALTER TABLE albums ADD COLUMN privacy TEXT DEFAULT 'Unknown'");
    }
    if (!albumCols.some(c => c.name === 'local_only')) {
      this.db.exec('ALTER TABLE albums ADD COLUMN local_only INTEGER DEFAULT 0');
    }

    const peopleCols = this.db.prepare('PRAGMA table_info(people)').all() as { name: string }[];
    if (!peopleCols.some(c => c.name === 'local_only')) {
      this.db.exec('ALTER TABLE people ADD COLUMN local_only INTEGER DEFAULT 0');
    }
  }

  // -----------------------------------------------------------
  // Albums
  // -----------------------------------------------------------

  upsertAlbum(
    albumKey: string,
    title: string,
    imageCount: number,
    coverImageUrl?: string,
    privacy?: AlbumPrivacy
  ): void {
    this.db.prepare(`
      INSERT INTO albums (album_key, title, image_count, cover_image_url, privacy, synced_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(album_key) DO UPDATE SET
        title = excluded.title,
        image_count = excluded.image_count,
        cover_image_url = COALESCE(excluded.cover_image_url, albums.cover_image_url),
        privacy = COALESCE(?, albums.privacy),
        synced_at = datetime('now')
    `).run(
      albumKey,
      title,
      imageCount,
      coverImageUrl || null,
      privacy ?? 'Unknown',
      privacy ?? null
    );
  }

  private mapAlbumRow(r: {
    id: number;
    albumKey: string;
    title: string;
    imageCount: number;
    coverImageUrl?: string;
    privacy?: string | null;
    localOnly: number;
    thumbsDownloaded: number;
    syncedAt?: string;
  }): AlbumRecord {
    return {
      id: r.id,
      albumKey: r.albumKey,
      title: r.title,
      imageCount: r.imageCount,
      coverImageUrl: r.coverImageUrl,
      privacy: (r.privacy as AlbumPrivacy) || 'Unknown',
      localOnly: Boolean(r.localOnly),
      thumbsDownloaded: Boolean(r.thumbsDownloaded),
      syncedAt: r.syncedAt,
    };
  }

  getAllAlbums(): AlbumRecord[] {
    const rows = this.db.prepare(`
      SELECT id, album_key as albumKey, title, image_count as imageCount,
             cover_image_url as coverImageUrl,
             privacy,
             local_only as localOnly,
             thumbs_downloaded as thumbsDownloaded,
             synced_at as syncedAt
      FROM albums ORDER BY title
    `).all() as Array<{
      id: number;
      albumKey: string;
      title: string;
      imageCount: number;
      coverImageUrl?: string;
      privacy?: string | null;
      localOnly: number;
      thumbsDownloaded: number;
      syncedAt?: string;
    }>;

    return rows.map(r => this.mapAlbumRow(r));
  }

  getAlbum(albumKey: string): AlbumRecord | undefined {
    const row = this.db.prepare(`
      SELECT id, album_key as albumKey, title, image_count as imageCount,
             cover_image_url as coverImageUrl,
             privacy,
             local_only as localOnly,
             thumbs_downloaded as thumbsDownloaded,
             synced_at as syncedAt
      FROM albums WHERE album_key = ?
    `).get(albumKey) as {
      id: number;
      albumKey: string;
      title: string;
      imageCount: number;
      coverImageUrl?: string;
      privacy?: string | null;
      localOnly: number;
      thumbsDownloaded: number;
      syncedAt?: string;
    } | undefined;

    return row ? this.mapAlbumRow(row) : undefined;
  }

  setAlbumLocalOnly(albumKey: string, localOnly: boolean): void {
    this.db.prepare('UPDATE albums SET local_only = ? WHERE album_key = ?').run(
      localOnly ? 1 : 0,
      albumKey
    );
  }

  markAlbumThumbsDownloaded(albumKey: string): void {
    this.db.prepare(`
      UPDATE albums SET thumbs_downloaded = 1 WHERE album_key = ?
    `).run(albumKey);
  }

  // -----------------------------------------------------------
  // Images
  // -----------------------------------------------------------

  upsertImage(
    imageKey: string,
    albumKey: string,
    filename: string,
    thumbUrl?: string,
    mediumUrl?: string,
    originalUrl?: string,
    existingKeywords?: string,
    webUri?: string
  ): void {
    this.db.prepare(`
      INSERT INTO images (image_key, album_key, filename, thumb_url, medium_url, original_url, existing_keywords, web_uri)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(image_key) DO UPDATE SET
        album_key = excluded.album_key,
        filename = excluded.filename,
        thumb_url = COALESCE(excluded.thumb_url, images.thumb_url),
        medium_url = COALESCE(excluded.medium_url, images.medium_url),
        original_url = COALESCE(excluded.original_url, images.original_url),
        existing_keywords = COALESCE(excluded.existing_keywords, images.existing_keywords),
        web_uri = COALESCE(excluded.web_uri, images.web_uri)
    `).run(
      imageKey,
      albumKey,
      filename,
      thumbUrl || null,
      mediumUrl || null,
      originalUrl || null,
      existingKeywords || null,
      webUri || null
    );
  }

  private static readonly IMAGE_COLUMNS = `
    id, image_key as imageKey, album_key as albumKey, filename,
    thumb_path as thumbPath, medium_path as mediumPath,
    thumb_url as thumbUrl, medium_url as mediumUrl, original_url as originalUrl,
    web_uri as webUri,
    thumb_downloaded as thumbDownloaded, medium_downloaded as mediumDownloaded,
    faces_detected as facesDetected, face_count as faceCount,
    tags_uploaded as tagsUploaded, existing_keywords as existingKeywords,
    detected_people as detectedPeople, created_at as createdAt
  `;

  private mapImageRow(
    r: Omit<ImageRecord, 'thumbDownloaded' | 'mediumDownloaded' | 'facesDetected' | 'tagsUploaded' | 'detectedPeople'> & {
      thumbDownloaded: number;
      mediumDownloaded: number;
      facesDetected: number;
      tagsUploaded: number;
      detectedPeople: string | null;
    }
  ): ImageRecord {
    return {
      ...r,
      thumbDownloaded: !!r.thumbDownloaded,
      mediumDownloaded: !!r.mediumDownloaded,
      facesDetected: !!r.facesDetected,
      tagsUploaded: !!r.tagsUploaded,
      detectedPeople: r.detectedPeople ? JSON.parse(r.detectedPeople) : undefined,
    };
  }

  getImagesByAlbum(albumKey: string): ImageRecord[] {
    const rows = this.db.prepare(`
      SELECT ${DatabaseService.IMAGE_COLUMNS}
      FROM images WHERE album_key = ? ORDER BY filename
    `).all(albumKey) as Parameters<DatabaseService['mapImageRow']>[0][];

    return rows.map(r => this.mapImageRow(r));
  }

  getImage(imageKey: string): ImageRecord | undefined {
    const r = this.db.prepare(`
      SELECT ${DatabaseService.IMAGE_COLUMNS}
      FROM images WHERE image_key = ?
    `).get(imageKey) as Parameters<DatabaseService['mapImageRow']>[0] | undefined;

    return r ? this.mapImageRow(r) : undefined;
  }

  markThumbDownloaded(imageKey: string, localPath: string): void {
    this.db.prepare(`
      UPDATE images SET thumb_downloaded = 1, thumb_path = ? WHERE image_key = ?
    `).run(localPath, imageKey);
  }

  markMediumDownloaded(imageKey: string, localPath: string): void {
    this.db.prepare(`
      UPDATE images SET medium_downloaded = 1, medium_path = ? WHERE image_key = ?
    `).run(localPath, imageKey);
  }

  clearMediumPath(imageKey: string): void {
    this.db.prepare(`
      UPDATE images SET medium_path = NULL, medium_downloaded = 0 WHERE image_key = ?
    `).run(imageKey);
  }

  markFacesDetected(imageKey: string, faceCount: number, detectedPeople?: FaceMatch[]): void {
    this.db.prepare(`
      UPDATE images SET faces_detected = 1, face_count = ?, detected_people = ? WHERE image_key = ?
    `).run(faceCount, detectedPeople ? JSON.stringify(detectedPeople) : null, imageKey);
  }

  markTagsUploaded(imageKey: string): void {
    this.db.prepare(`
      UPDATE images SET tags_uploaded = 1 WHERE image_key = ?
    `).run(imageKey);
    // Also mark every tag row for this image as uploaded
    this.db.prepare(`
      UPDATE image_tags SET uploaded = 1 WHERE image_key = ?
    `).run(imageKey);
  }

  updateImageKeywords(imageKey: string, keywords: string): void {
    this.db.prepare(`
      UPDATE images SET existing_keywords = ? WHERE image_key = ?
    `).run(keywords, imageKey);
  }

  getUntaggedImagesWithFaces(): ImageRecord[] {
    const rows = this.db.prepare(`
      SELECT ${DatabaseService.IMAGE_COLUMNS}
      FROM images
      WHERE faces_detected = 1 AND tags_uploaded = 0 AND detected_people IS NOT NULL
      ORDER BY album_key, filename
    `).all() as Parameters<DatabaseService['mapImageRow']>[0][];

    return rows.map(r => this.mapImageRow(r));
  }

  /** Images that have faces detected but haven't been matched against trained people yet. */
  getImagesWithFacesForMatching(): ImageRecord[] {
    const rows = this.db.prepare(`
      SELECT ${DatabaseService.IMAGE_COLUMNS}
      FROM images
      WHERE faces_detected = 1 AND medium_downloaded = 1 AND tags_uploaded = 0
      ORDER BY album_key, filename
    `).all() as Parameters<DatabaseService['mapImageRow']>[0][];

    return rows.map(r => this.mapImageRow(r));
  }

  /** Images eligible for matching using stored detected_faces (even after medium cache purge). */
  getImagesWithStoredFaces(): ImageRecord[] {
    const rows = this.db.prepare(`
      SELECT ${DatabaseService.IMAGE_COLUMNS}
      FROM images
      WHERE faces_detected = 1 AND tags_uploaded = 0
      ORDER BY album_key, filename
    `).all() as Parameters<DatabaseService['mapImageRow']>[0][];

    return rows.map(r => this.mapImageRow(r));
  }

  saveDetectedFaces(imageKey: string, faces: DetectedFace[]): void {
    const deleteOld = this.db.prepare('DELETE FROM detected_faces WHERE image_key = ?');
    const insert = this.db.prepare(`
      INSERT INTO detected_faces (image_key, descriptor, bbox_x, bbox_y, bbox_w, bbox_h)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction(() => {
      deleteOld.run(imageKey);
      for (const face of faces) {
        const buffer = Buffer.from(
          face.descriptor.buffer,
          face.descriptor.byteOffset,
          face.descriptor.byteLength
        );
        insert.run(
          imageKey,
          buffer,
          face.bbox.x,
          face.bbox.y,
          face.bbox.width,
          face.bbox.height
        );
      }
    });

    transaction();
  }

  getDetectedFaces(imageKey: string): DetectedFace[] {
    const rows = this.db.prepare(`
      SELECT descriptor, bbox_x, bbox_y, bbox_w, bbox_h
      FROM detected_faces
      WHERE image_key = ?
      ORDER BY id
    `).all(imageKey) as {
      descriptor: Buffer;
      bbox_x: number;
      bbox_y: number;
      bbox_w: number;
      bbox_h: number;
    }[];

    return rows.map(r => {
      const aligned = r.descriptor.buffer.slice(
        r.descriptor.byteOffset,
        r.descriptor.byteOffset + r.descriptor.byteLength
      );
      return {
        descriptor: new Float32Array(aligned),
        bbox: { x: r.bbox_x, y: r.bbox_y, width: r.bbox_w, height: r.bbox_h },
      };
    });
  }

  /** Overwrite the detected_people field for an image (used to approve/reject matches). */
  updateDetectedPeople(imageKey: string, detectedPeople: FaceMatch[]): void {
    this.db.prepare(`
      UPDATE images SET detected_people = ? WHERE image_key = ?
    `).run(JSON.stringify(detectedPeople), imageKey);
  }

  // -----------------------------------------------------------
  // image_tags — normalized per-person tag rows
  // -----------------------------------------------------------

  /**
   * Atomically replace all tag rows for an image with the latest matches.
   * Deletes old rows first so re-runs don't create duplicates.
   */
  saveImageTags(imageKey: string, matches: FaceMatch[]): void {
    const deleteOld = this.db.prepare(`DELETE FROM image_tags WHERE image_key = ?`);
    const insert = this.db.prepare(`
      INSERT INTO image_tags (image_key, person_name, confidence, bbox_x, bbox_y, bbox_w, bbox_h)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction(() => {
      deleteOld.run(imageKey);
      for (const m of matches) {
        insert.run(
          imageKey,
          m.personName,
          m.confidence,
          m.bbox.x,
          m.bbox.y,
          m.bbox.width,
          m.bbox.height,
        );
      }
    });

    transaction();
  }

  /** Approve a specific person tag on an image. */
  approveImageTag(imageKey: string, personName: string): void {
    this.db.prepare(`
      UPDATE image_tags SET approved = 1
      WHERE image_key = ? AND person_name = ?
    `).run(imageKey, personName);
  }

  /** Mark a specific person tag on an image as uploaded to SmugMug. */
  markTagUploaded(imageKey: string, personName: string): void {
    this.db.prepare(`
      UPDATE image_tags SET uploaded = 1
      WHERE image_key = ? AND person_name = ?
    `).run(imageKey, personName);
  }

  /** Return all images that have a tag for a given person. */
  getImagesByPerson(personName: string): string[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT image_key FROM image_tags WHERE person_name = ?
    `).all(personName) as { image_key: string }[];
    return rows.map(r => r.image_key);
  }

  /** Return all tag rows that have not yet been uploaded. */
  getPendingUploadTags(): ImageTagRow[] {
    return this.db.prepare(`
      SELECT id, image_key as imageKey, person_name as personName,
             confidence, bbox_x as bboxX, bbox_y as bboxY,
             bbox_w as bboxW, bbox_h as bboxH,
             approved, uploaded, tagged_at as taggedAt
      FROM image_tags WHERE uploaded = 0
      ORDER BY image_key, person_name
    `).all() as ImageTagRow[];
  }

  /** Return tag rows filtered by a minimum confidence threshold. */
  getTagsByMinConfidence(threshold: number): ImageTagRow[] {
    return this.db.prepare(`
      SELECT id, image_key as imageKey, person_name as personName,
             confidence, bbox_x as bboxX, bbox_y as bboxY,
             bbox_w as bboxW, bbox_h as bboxH,
             approved, uploaded, tagged_at as taggedAt
      FROM image_tags WHERE confidence >= ?
      ORDER BY confidence DESC
    `).all(threshold) as ImageTagRow[];
  }

  /** Return all tag rows for a single image (tag summary). */
  getTagSummary(imageKey: string): ImageTagRow[] {
    return this.db.prepare(`
      SELECT id, image_key as imageKey, person_name as personName,
             confidence, bbox_x as bboxX, bbox_y as bboxY,
             bbox_w as bboxW, bbox_h as bboxH,
             approved, uploaded, tagged_at as taggedAt
      FROM image_tags WHERE image_key = ?
      ORDER BY confidence DESC
    `).all(imageKey) as ImageTagRow[];
  }

  /** Return approved tag rows for a single image. */
  getApprovedTagsForImage(imageKey: string): ImageTagRow[] {
    return this.db.prepare(`
      SELECT id, image_key as imageKey, person_name as personName,
             confidence, bbox_x as bboxX, bbox_y as bboxY,
             bbox_w as bboxW, bbox_h as bboxH,
             approved, uploaded, tagged_at as taggedAt
      FROM image_tags
      WHERE image_key = ? AND approved = 1
      ORDER BY confidence DESC
    `).all(imageKey) as ImageTagRow[];
  }

  /** Return distinct approved person names for a single image. */
  getApprovedPersonNamesForImage(imageKey: string): string[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT person_name as personName
      FROM image_tags
      WHERE image_key = ? AND approved = 1
      ORDER BY id
    `).all(imageKey) as { personName: string }[];
    return rows.map(r => r.personName);
  }

  /** Return all tagged images and their tag metadata formatted for manifest/CSV/XMP export. */
  getAllExportableImageTags(albumKey?: string): Record<string, TagManifestImageEntry> {
    const query = `
      SELECT t.image_key as imageKey,
             COALESCE(i.album_key, '') as albumKey,
             COALESCE(a.title, '') as albumTitle,
             COALESCE(i.filename, t.image_key) as filename,
             COALESCE(i.web_uri, '') as webUri,
             t.person_name as personName,
             COALESCE(t.confidence, 0) as confidence,
             COALESCE(t.bbox_x, 0) as bboxX,
             COALESCE(t.bbox_y, 0) as bboxY,
             COALESCE(t.bbox_w, 0) as bboxW,
             COALESCE(t.bbox_h, 0) as bboxH,
             t.approved as approved,
             t.uploaded as uploaded,
             COALESCE(t.tagged_at, '') as taggedAt
      FROM image_tags t
      JOIN images i ON i.image_key = t.image_key
      LEFT JOIN albums a ON a.album_key = i.album_key
      ${albumKey ? 'WHERE i.album_key = ?' : ''}
      ORDER BY a.title, i.filename, t.confidence DESC
    `;

    const rows = (
      albumKey
        ? this.db.prepare(query).all(albumKey)
        : this.db.prepare(query).all()
    ) as Array<{
      imageKey: string;
      albumKey: string;
      albumTitle: string;
      filename: string;
      webUri: string;
      personName: string;
      confidence: number;
      bboxX: number;
      bboxY: number;
      bboxW: number;
      bboxH: number;
      approved: number;
      uploaded: number;
      taggedAt: string;
    }>;

    const grouped: Record<string, TagManifestImageEntry> = {};
    for (const row of rows) {
      if (!grouped[row.imageKey]) {
        grouped[row.imageKey] = {
          imageKey: row.imageKey,
          albumKey: row.albumKey,
          albumTitle: row.albumTitle,
          filename: row.filename,
          webUri: row.webUri,
          tags: [],
        };
      }
      grouped[row.imageKey].tags.push({
        personName: row.personName,
        confidence: row.confidence,
        bbox: {
          x: row.bboxX,
          y: row.bboxY,
          width: row.bboxW,
          height: row.bboxH,
        },
        approved: Boolean(row.approved),
        uploaded: Boolean(row.uploaded),
        taggedAt: row.taggedAt,
      });
    }

    return grouped;
  }

  /** Restore image_tags and image recognition metadata from a validated JSON manifest. */
  restoreImageTagsFromManifest(
    images: Record<string, TagManifestImageEntry>
  ): { importedCount: number; skippedCount: number } {
    const checkImage = this.db.prepare('SELECT image_key, face_count FROM images WHERE image_key = ?');
    const deleteTags = this.db.prepare('DELETE FROM image_tags WHERE image_key = ?');
    const insertTag = this.db.prepare(`
      INSERT INTO image_tags (image_key, person_name, confidence, bbox_x, bbox_y, bbox_w, bbox_h, approved, uploaded, tagged_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateImage = this.db.prepare(`
      UPDATE images
      SET faces_detected = 1,
          face_count = ?,
          detected_people = ?,
          tags_uploaded = ?
      WHERE image_key = ?
    `);

    let importedCount = 0;
    let skippedCount = 0;

    const transaction = this.db.transaction(() => {
      for (const [imageKey, entry] of Object.entries(images)) {
        const existing = checkImage.get(imageKey) as { image_key: string; face_count: number } | undefined;
        if (!existing) {
          skippedCount += entry.tags.length;
          continue;
        }

        deleteTags.run(imageKey);
        const matches: FaceMatch[] = [];
        for (const tag of entry.tags) {
          insertTag.run(
            imageKey,
            tag.personName,
            tag.confidence,
            tag.bbox.x,
            tag.bbox.y,
            tag.bbox.width,
            tag.bbox.height,
            tag.approved ? 1 : 0,
            tag.uploaded ? 1 : 0,
            tag.taggedAt || new Date().toISOString()
          );
          matches.push({
            personName: tag.personName,
            confidence: tag.confidence,
            distance: Math.max(0, 1 - tag.confidence),
            bbox: tag.bbox,
          });
          importedCount++;
        }

        const faceCount = Math.max(existing.face_count || 0, entry.tags.length);
        const allUploaded = entry.tags.length > 0 && entry.tags.every(t => t.uploaded) ? 1 : 0;
        updateImage.run(faceCount, JSON.stringify(matches), allUploaded, imageKey);
      }
    });

    transaction();
    return { importedCount, skippedCount };
  }

  // -----------------------------------------------------------
  // People & Face Descriptors
  // -----------------------------------------------------------

  addPerson(name: string): number {
    this.db.prepare(`
      INSERT INTO people (name) VALUES (?)
      ON CONFLICT(name) DO NOTHING
    `).run(name);
    const row = this.db.prepare('SELECT id FROM people WHERE name = ?').get(name) as { id: number };
    return row.id;
  }

  getPersonById(personId: number): Person | undefined {
    const row = this.db.prepare(`
      SELECT p.id, p.name, p.local_only as localOnly, p.created_at as createdAt,
             COUNT(fd.id) as descriptorCount
      FROM people p
      LEFT JOIN face_descriptors fd ON fd.person_id = p.id
      WHERE p.id = ?
      GROUP BY p.id
    `).get(personId) as (Omit<Person, 'localOnly'> & { localOnly: number }) | undefined;
    if (!row) return undefined;
    return {
      ...row,
      localOnly: Boolean(row.localOnly),
    };
  }

  getPersonByName(name: string): Person | undefined {
    const row = this.db.prepare(`
      SELECT p.id, p.name, p.local_only as localOnly, p.created_at as createdAt,
             COUNT(fd.id) as descriptorCount
      FROM people p
      LEFT JOIN face_descriptors fd ON fd.person_id = p.id
      WHERE p.name = ?
      GROUP BY p.id
    `).get(name) as (Omit<Person, 'localOnly'> & { localOnly: number }) | undefined;
    if (!row) return undefined;
    return {
      ...row,
      localOnly: Boolean(row.localOnly),
    };
  }

  getAllPeople(): Person[] {
    const rows = this.db.prepare(`
      SELECT p.id, p.name, p.local_only as localOnly, p.created_at as createdAt,
             COUNT(fd.id) as descriptorCount
      FROM people p
      LEFT JOIN face_descriptors fd ON fd.person_id = p.id
      GROUP BY p.id
      ORDER BY p.name
    `).all() as (Omit<Person, 'localOnly'> & { localOnly: number })[];
    return rows.map(row => ({
      ...row,
      localOnly: Boolean(row.localOnly),
    }));
  }

  setPersonLocalOnly(personId: number, localOnly: boolean): void {
    this.db.prepare('UPDATE people SET local_only = ? WHERE id = ?').run(
      localOnly ? 1 : 0,
      personId
    );
  }

  deletePerson(personId: number): void {
    this.db.prepare('DELETE FROM people WHERE id = ?').run(personId);
  }

  forgetPersonLocal(personId: number): { personName: string; affectedImageKeys: string[] } {
    const transaction = this.db.transaction(() => {
      const person = this.getPersonById(personId);
      if (!person) {
        throw new Error(`Person not found: ${personId}`);
      }

      const affectedRows = this.db.prepare(`
        SELECT DISTINCT image_key FROM image_tags WHERE person_name = ?
      `).all(person.name) as { image_key: string }[];
      const affectedImageKeys = affectedRows.map(r => r.image_key);

      // Deleting from people cascades to face_descriptors
      this.db.prepare('DELETE FROM people WHERE id = ?').run(personId);
      this.db.prepare('DELETE FROM image_tags WHERE person_name = ?').run(person.name);

      const getDetectedStmt = this.db.prepare('SELECT detected_people FROM images WHERE image_key = ?');
      const updateDetectedStmt = this.db.prepare('UPDATE images SET detected_people = ? WHERE image_key = ?');

      for (const imageKey of affectedImageKeys) {
        const imgRow = getDetectedStmt.get(imageKey) as { detected_people: string | null } | undefined;
        if (!imgRow?.detected_people) continue;
        try {
          const parsed = JSON.parse(imgRow.detected_people) as FaceMatch[];
          const remaining = parsed.filter(m => m.personName !== person.name);
          updateDetectedStmt.run(remaining.length > 0 ? JSON.stringify(remaining) : null, imageKey);
        } catch {
          // Ignore malformed JSON if any
        }
      }

      return { personName: person.name, affectedImageKeys };
    });

    return transaction();
  }

  addFaceDescriptor(
    personId: number,
    descriptor: Float32Array,
    sourceImageKey: string,
    bbox: BoundingBox
  ): void {
    const buffer = Buffer.from(descriptor.buffer);
    this.db.prepare(`
      INSERT INTO face_descriptors (person_id, descriptor, source_image_key, bbox_x, bbox_y, bbox_w, bbox_h)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(personId, buffer, sourceImageKey, bbox.x, bbox.y, bbox.width, bbox.height);
  }

  getDescriptorsForPerson(personId: number): { descriptor: Float32Array; bbox: BoundingBox }[] {
    const rows = this.db.prepare(`
      SELECT descriptor, bbox_x, bbox_y, bbox_w, bbox_h
      FROM face_descriptors WHERE person_id = ?
    `).all(personId) as { descriptor: Buffer; bbox_x: number; bbox_y: number; bbox_w: number; bbox_h: number }[];

    return rows.map(r => ({
      descriptor: new Float32Array(r.descriptor.buffer, r.descriptor.byteOffset, r.descriptor.byteLength / 4),
      bbox: { x: r.bbox_x, y: r.bbox_y, width: r.bbox_w, height: r.bbox_h },
    }));
  }

  getAllDescriptors(): { personId: number; personName: string; descriptor: Float32Array }[] {
    const rows = this.db.prepare(`
      SELECT fd.person_id as personId, p.name as personName, fd.descriptor
      FROM face_descriptors fd
      JOIN people p ON p.id = fd.person_id
    `).all() as { personId: number; personName: string; descriptor: Buffer }[];

    return rows.map(r => ({
      personId: r.personId,
      personName: r.personName,
      descriptor: new Float32Array(r.descriptor.buffer, r.descriptor.byteOffset, r.descriptor.byteLength / 4),
    }));
  }

  // -----------------------------------------------------------
  // Statistics
  // -----------------------------------------------------------

  getStats(): DatabaseStats {
    const albumCount = (this.db.prepare('SELECT COUNT(*) as c FROM albums').get() as { c: number }).c;
    const imageCount = (this.db.prepare('SELECT COUNT(*) as c FROM images').get() as { c: number }).c;
    const downloadedThumbs = (this.db.prepare('SELECT COUNT(*) as c FROM images WHERE thumb_downloaded = 1').get() as { c: number }).c;
    const downloadedMedium = (this.db.prepare('SELECT COUNT(*) as c FROM images WHERE medium_downloaded = 1').get() as { c: number }).c;
    const facesDetected = (this.db.prepare('SELECT COUNT(*) as c FROM images WHERE faces_detected = 1').get() as { c: number }).c;
    const peopleCount = (this.db.prepare('SELECT COUNT(*) as c FROM people').get() as { c: number }).c;
    const descriptorCount = (this.db.prepare('SELECT COUNT(*) as c FROM face_descriptors').get() as { c: number }).c;
    const taggedImages = (this.db.prepare('SELECT COUNT(*) as c FROM images WHERE tags_uploaded = 1').get() as { c: number }).c;

    return {
      albumCount,
      imageCount,
      downloadedThumbs,
      downloadedMedium,
      facesDetected,
      peopleCount,
      descriptorCount,
      taggedImages,
    };
  }

  // -----------------------------------------------------------
  // Maintenance
  // -----------------------------------------------------------

  clearTrainingData(): void {
    this.db.exec('DELETE FROM image_tags');
    this.db.exec('DELETE FROM face_descriptors');
    this.db.exec('DELETE FROM people');
    this.db.exec('UPDATE images SET faces_detected = 0, face_count = 0, detected_people = NULL, tags_uploaded = 0');
  }

  resetDatabase(): void {
    this.db.exec('DROP TABLE IF EXISTS detected_faces');
    this.db.exec('DROP TABLE IF EXISTS image_tags');
    this.db.exec('DROP TABLE IF EXISTS face_descriptors');
    this.db.exec('DROP TABLE IF EXISTS people');
    this.db.exec('DROP TABLE IF EXISTS images');
    this.db.exec('DROP TABLE IF EXISTS albums');
    this.initSchema();
  }

  close(): void {
    this.db.close();
  }
}
