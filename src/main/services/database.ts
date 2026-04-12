// ============================================================
// SQLite Database Service (better-sqlite3)
// ============================================================

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import type {
  Person,
  AlbumRecord,
  ImageRecord,
  FaceMatch,
  DatabaseStats,
  BoundingBox,
} from '../../shared/types';

export class DatabaseService {
  private db: Database.Database;

  constructor(dataDir: string) {
    const dbDir = dataDir;
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    const dbPath = path.join(dbDir, 'smugmug_tagger.db');
    this.db = new Database(dbPath);

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
    `);
  }

  // -----------------------------------------------------------
  // Albums
  // -----------------------------------------------------------

  upsertAlbum(albumKey: string, title: string, imageCount: number, coverImageUrl?: string): void {
    this.db.prepare(`
      INSERT INTO albums (album_key, title, image_count, cover_image_url, synced_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(album_key) DO UPDATE SET
        title = excluded.title,
        image_count = excluded.image_count,
        cover_image_url = excluded.cover_image_url,
        synced_at = datetime('now')
    `).run(albumKey, title, imageCount, coverImageUrl || null);
  }

  getAllAlbums(): AlbumRecord[] {
    return this.db.prepare(`
      SELECT id, album_key as albumKey, title, image_count as imageCount,
             cover_image_url as coverImageUrl,
             thumbs_downloaded as thumbsDownloaded,
             synced_at as syncedAt
      FROM albums ORDER BY title
    `).all() as AlbumRecord[];
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
    existingKeywords?: string
  ): void {
    this.db.prepare(`
      INSERT INTO images (image_key, album_key, filename, thumb_url, medium_url, original_url, existing_keywords)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(image_key) DO UPDATE SET
        album_key = excluded.album_key,
        filename = excluded.filename,
        thumb_url = COALESCE(excluded.thumb_url, images.thumb_url),
        medium_url = COALESCE(excluded.medium_url, images.medium_url),
        original_url = COALESCE(excluded.original_url, images.original_url),
        existing_keywords = COALESCE(excluded.existing_keywords, images.existing_keywords)
    `).run(imageKey, albumKey, filename, thumbUrl || null, mediumUrl || null, originalUrl || null, existingKeywords || null);
  }

  getImagesByAlbum(albumKey: string): ImageRecord[] {
    const rows = this.db.prepare(`
      SELECT id, image_key as imageKey, album_key as albumKey, filename,
             thumb_path as thumbPath, medium_path as mediumPath,
             thumb_url as thumbUrl, medium_url as mediumUrl, original_url as originalUrl,
             thumb_downloaded as thumbDownloaded, medium_downloaded as mediumDownloaded,
             faces_detected as facesDetected, face_count as faceCount,
             tags_uploaded as tagsUploaded, existing_keywords as existingKeywords,
             detected_people as detectedPeople, created_at as createdAt
      FROM images WHERE album_key = ? ORDER BY filename
    `).all(albumKey) as (Omit<ImageRecord, 'thumbDownloaded' | 'mediumDownloaded' | 'facesDetected' | 'tagsUploaded' | 'detectedPeople'> & {
      thumbDownloaded: number;
      mediumDownloaded: number;
      facesDetected: number;
      tagsUploaded: number;
      detectedPeople: string | null;
    })[];

    return rows.map(r => ({
      ...r,
      thumbDownloaded: !!r.thumbDownloaded,
      mediumDownloaded: !!r.mediumDownloaded,
      facesDetected: !!r.facesDetected,
      tagsUploaded: !!r.tagsUploaded,
      detectedPeople: r.detectedPeople ? JSON.parse(r.detectedPeople) : undefined,
    }));
  }

  getImage(imageKey: string): ImageRecord | undefined {
    const r = this.db.prepare(`
      SELECT id, image_key as imageKey, album_key as albumKey, filename,
             thumb_path as thumbPath, medium_path as mediumPath,
             thumb_url as thumbUrl, medium_url as mediumUrl, original_url as originalUrl,
             thumb_downloaded as thumbDownloaded, medium_downloaded as mediumDownloaded,
             faces_detected as facesDetected, face_count as faceCount,
             tags_uploaded as tagsUploaded, existing_keywords as existingKeywords,
             detected_people as detectedPeople, created_at as createdAt
      FROM images WHERE image_key = ?
    `).get(imageKey) as (Omit<ImageRecord, 'thumbDownloaded' | 'mediumDownloaded' | 'facesDetected' | 'tagsUploaded' | 'detectedPeople'> & {
      thumbDownloaded: number;
      mediumDownloaded: number;
      facesDetected: number;
      tagsUploaded: number;
      detectedPeople: string | null;
    }) | undefined;

    if (!r) return undefined;

    return {
      ...r,
      thumbDownloaded: !!r.thumbDownloaded,
      mediumDownloaded: !!r.mediumDownloaded,
      facesDetected: !!r.facesDetected,
      tagsUploaded: !!r.tagsUploaded,
      detectedPeople: r.detectedPeople ? JSON.parse(r.detectedPeople) : undefined,
    };
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

  markFacesDetected(imageKey: string, faceCount: number, detectedPeople?: FaceMatch[]): void {
    this.db.prepare(`
      UPDATE images SET faces_detected = 1, face_count = ?, detected_people = ? WHERE image_key = ?
    `).run(faceCount, detectedPeople ? JSON.stringify(detectedPeople) : null, imageKey);
  }

  markTagsUploaded(imageKey: string): void {
    this.db.prepare(`
      UPDATE images SET tags_uploaded = 1 WHERE image_key = ?
    `).run(imageKey);
  }

  getUntaggedImagesWithFaces(): ImageRecord[] {
    const rows = this.db.prepare(`
      SELECT id, image_key as imageKey, album_key as albumKey, filename,
             thumb_path as thumbPath, medium_path as mediumPath,
             thumb_url as thumbUrl, medium_url as mediumUrl, original_url as originalUrl,
             thumb_downloaded as thumbDownloaded, medium_downloaded as mediumDownloaded,
             faces_detected as facesDetected, face_count as faceCount,
             tags_uploaded as tagsUploaded, existing_keywords as existingKeywords,
             detected_people as detectedPeople, created_at as createdAt
      FROM images
      WHERE faces_detected = 1 AND tags_uploaded = 0 AND detected_people IS NOT NULL
      ORDER BY album_key, filename
    `).all() as (Omit<ImageRecord, 'thumbDownloaded' | 'mediumDownloaded' | 'facesDetected' | 'tagsUploaded' | 'detectedPeople'> & {
      thumbDownloaded: number;
      mediumDownloaded: number;
      facesDetected: number;
      tagsUploaded: number;
      detectedPeople: string | null;
    })[];

    return rows.map(r => ({
      ...r,
      thumbDownloaded: !!r.thumbDownloaded,
      mediumDownloaded: !!r.mediumDownloaded,
      facesDetected: !!r.facesDetected,
      tagsUploaded: !!r.tagsUploaded,
      detectedPeople: r.detectedPeople ? JSON.parse(r.detectedPeople) : undefined,
    }));
  }

  /** Images that have faces detected but haven't been matched against trained people yet. */
  getImagesWithFacesForMatching(): ImageRecord[] {
    const rows = this.db.prepare(`
      SELECT id, image_key as imageKey, album_key as albumKey, filename,
             thumb_path as thumbPath, medium_path as mediumPath,
             thumb_url as thumbUrl, medium_url as mediumUrl, original_url as originalUrl,
             thumb_downloaded as thumbDownloaded, medium_downloaded as mediumDownloaded,
             faces_detected as facesDetected, face_count as faceCount,
             tags_uploaded as tagsUploaded, existing_keywords as existingKeywords,
             detected_people as detectedPeople, created_at as createdAt
      FROM images
      WHERE faces_detected = 1 AND medium_downloaded = 1 AND tags_uploaded = 0
      ORDER BY album_key, filename
    `).all() as (Omit<ImageRecord, 'thumbDownloaded' | 'mediumDownloaded' | 'facesDetected' | 'tagsUploaded' | 'detectedPeople'> & {
      thumbDownloaded: number;
      mediumDownloaded: number;
      facesDetected: number;
      tagsUploaded: number;
      detectedPeople: string | null;
    })[];

    return rows.map(r => ({
      ...r,
      thumbDownloaded: !!r.thumbDownloaded,
      mediumDownloaded: !!r.mediumDownloaded,
      facesDetected: !!r.facesDetected,
      tagsUploaded: !!r.tagsUploaded,
      detectedPeople: r.detectedPeople ? JSON.parse(r.detectedPeople) : undefined,
    }));
  }

  /** Overwrite the detected_people field for an image (used to approve/reject matches). */
  updateDetectedPeople(imageKey: string, detectedPeople: FaceMatch[]): void {
    this.db.prepare(`
      UPDATE images SET detected_people = ? WHERE image_key = ?
    `).run(JSON.stringify(detectedPeople), imageKey);
  }

  // -----------------------------------------------------------
  // People & Face Descriptors
  // -----------------------------------------------------------

  addPerson(name: string): number {
    const result = this.db.prepare(`
      INSERT INTO people (name) VALUES (?)
      ON CONFLICT(name) DO UPDATE SET name = excluded.name
    `).run(name);
    return Number(result.lastInsertRowid);
  }

  getPersonByName(name: string): Person | undefined {
    const row = this.db.prepare(`
      SELECT p.id, p.name, p.created_at as createdAt,
             COUNT(fd.id) as descriptorCount
      FROM people p
      LEFT JOIN face_descriptors fd ON fd.person_id = p.id
      WHERE p.name = ?
      GROUP BY p.id
    `).get(name) as Person | undefined;
    return row;
  }

  getAllPeople(): Person[] {
    return this.db.prepare(`
      SELECT p.id, p.name, p.created_at as createdAt,
             COUNT(fd.id) as descriptorCount
      FROM people p
      LEFT JOIN face_descriptors fd ON fd.person_id = p.id
      GROUP BY p.id
      ORDER BY p.name
    `).all() as Person[];
  }

  deletePerson(personId: number): void {
    this.db.prepare('DELETE FROM people WHERE id = ?').run(personId);
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
    this.db.exec('DELETE FROM face_descriptors');
    this.db.exec('DELETE FROM people');
    this.db.exec("UPDATE images SET faces_detected = 0, face_count = 0, detected_people = NULL, tags_uploaded = 0");
  }

  resetDatabase(): void {
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
