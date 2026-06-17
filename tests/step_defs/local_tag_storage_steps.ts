import { Given, When, Then, DataTable, Before, After } from '@cucumber/cucumber';
import Database from 'better-sqlite3';
import assert from 'node:assert/strict';
import type { FaceMatch } from '../../src/shared/types';

// -----------------------------------------------------------
// In-memory DB shared across steps in a scenario
// -----------------------------------------------------------

let db: Database.Database;
let lastQueryResult: unknown[];
let stagedMatches: FaceMatch[] = [];
let lastImageKey: string;

Before(function () {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY,
      image_key TEXT UNIQUE NOT NULL,
      album_key TEXT,
      filename TEXT,
      faces_detected INTEGER DEFAULT 0,
      face_count INTEGER DEFAULT 0,
      tags_uploaded INTEGER DEFAULT 0,
      existing_keywords TEXT,
      detected_people TEXT
    );

    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE NOT NULL
    );

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
  `);
  stagedMatches = [];
  lastQueryResult = [];
  lastImageKey = '';
});

After(function () {
  if (db?.open) db.close();
});

// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------

function saveImageTags(imageKey: string, matches: FaceMatch[]): void {
  const del = db.prepare('DELETE FROM image_tags WHERE image_key = ?');
  const ins = db.prepare(`
    INSERT INTO image_tags (image_key, person_name, confidence, bbox_x, bbox_y, bbox_w, bbox_h)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    del.run(imageKey);
    for (const m of matches) {
      ins.run(imageKey, m.personName, m.confidence, m.bbox.x, m.bbox.y, m.bbox.width, m.bbox.height);
    }
  });
  tx();
}

function insertImage(imageKey: string): void {
  db.prepare(`
    INSERT OR IGNORE INTO images (image_key, filename, faces_detected, face_count)
    VALUES (?, ?, 0, 0)
  `).run(imageKey, `${imageKey}.jpg`);
}

function insertTagRow(imageKey: string, personName: string, confidence = 0.8, approved = 0, uploaded = 0): void {
  insertImage(imageKey);
  db.prepare(`
    INSERT INTO image_tags (image_key, person_name, confidence, approved, uploaded, bbox_x, bbox_y, bbox_w, bbox_h)
    VALUES (?, ?, ?, ?, ?, 0, 0, 0.1, 0.1)
  `).run(imageKey, personName, confidence, approved, uploaded);
}

// -----------------------------------------------------------
// Background
// -----------------------------------------------------------

Given('the local SQLite database is initialized', function () {
  // db is initialized fresh in the Before hook
  assert.ok(db.open, 'Database should be open');
});

Given('the {string} table exists with columns:', function (tableName: string, _dataTable: DataTable) {
  const tables = db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name=?
  `).all(tableName) as { name: string }[];
  assert.equal(tables.length, 1, `Table "${tableName}" should exist`);
});

// -----------------------------------------------------------
// Writing Tags
// -----------------------------------------------------------

Given('an image {string} has been scanned and {int} faces detected', function (imageKey: string, faceCount: number) {
  insertImage(imageKey);
  db.prepare('UPDATE images SET faces_detected = 1, face_count = ? WHERE image_key = ?').run(faceCount, imageKey);
  lastImageKey = imageKey;
});

Given('the auto-tagger recognizes {string} with {int}% confidence', function (personName: string, confidencePct: number) {
  stagedMatches.push({
    personName,
    confidence: confidencePct / 100,
    distance: 1 - (confidencePct / 100),
    bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.3 },
  });
});

When('the auto-tagger saves the results', function () {
  saveImageTags(lastImageKey, stagedMatches);
});

Then('the {string} table should contain {int} rows for {string}', function (tableName: string, rowCount: number, imageKey: string) {
  const count = (db.prepare(`SELECT COUNT(*) as c FROM ${tableName} WHERE image_key = ?`).get(imageKey) as { c: number }).c;
  assert.equal(count, rowCount);
});

Then('one row should have person_name {string} and confidence {float}', function (personName: string, confidence: number) {
  const row = db.prepare(`
    SELECT * FROM image_tags WHERE image_key = ? AND person_name = ?
  `).get(lastImageKey, personName) as { confidence: number } | undefined;
  assert.ok(row, `Row for ${personName} should exist`);
  assert.ok(Math.abs(row.confidence - confidence) < 0.001, `Confidence should be ~${confidence}, got ${row.confidence}`);
});

Then('both rows should have approved = {int} and uploaded = {int}', function (approved: number, uploaded: number) {
  const rows = db.prepare(`SELECT * FROM image_tags WHERE image_key = ?`).all(lastImageKey) as { approved: number; uploaded: number }[];
  for (const row of rows) {
    assert.equal(row.approved, approved);
    assert.equal(row.uploaded, uploaded);
  }
});

Given('the {string} table has an unapproved tag for {string} and {string}', function (_tableName: string, imageKey: string, personName: string) {
  insertTagRow(imageKey, personName, 0.8, 0, 0);
  lastImageKey = imageKey;
});

When('the user approves the tag for {string} on {string}', function (personName: string, imageKey: string) {
  db.prepare('UPDATE image_tags SET approved = 1 WHERE image_key = ? AND person_name = ?').run(imageKey, personName);
});

Then('the tag row should have approved = {int}', function (approved: number) {
  const row = db.prepare('SELECT approved FROM image_tags WHERE image_key = ?').get(lastImageKey) as { approved: number };
  assert.equal(row.approved, approved);
});

Given('an approved tag exists for {string} and {string}', function (imageKey: string, personName: string) {
  insertTagRow(imageKey, personName, 0.9, 1, 0);
  lastImageKey = imageKey;
});

When('the tag is successfully uploaded to SmugMug', function () {
  db.prepare('UPDATE image_tags SET uploaded = 1 WHERE image_key = ?').run(lastImageKey);
});

Then('the tag row should have uploaded = {int}', function (uploaded: number) {
  const row = db.prepare('SELECT uploaded FROM image_tags WHERE image_key = ?').get(lastImageKey) as { uploaded: number };
  assert.equal(row.uploaded, uploaded);
});

Then('the {string} timestamp should be set', function (columnName: string) {
  const row = db.prepare(`SELECT ${columnName} as val FROM image_tags WHERE image_key = ?`).get(lastImageKey) as { val: string };
  assert.ok(row.val, `${columnName} should be set`);
});

Given('{string} already has tag rows for {string} and {string}', function (imageKey: string, person1: string, person2: string) {
  insertTagRow(imageKey, person1, 0.8);
  insertTagRow(imageKey, person2, 0.6);
  lastImageKey = imageKey;
});

When('the auto-tagger runs again on {string}', function (imageKey: string) {
  const newMatches: FaceMatch[] = [{
    personName: 'New Person',
    confidence: 0.91,
    distance: 0.09,
    bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.3 },
  }];
  saveImageTags(imageKey, newMatches);
});

Then('old tag rows for {string} should be deleted', function (imageKey: string) {
  const oldRows = db.prepare(
    "SELECT * FROM image_tags WHERE image_key = ? AND person_name IN ('Jane Smith', 'Old Person')"
  ).all(imageKey);
  assert.equal(oldRows.length, 0, 'Old tag rows should be gone');
});

Then('new tag rows should be inserted with the latest recognition results', function () {
  const rows = db.prepare('SELECT * FROM image_tags WHERE image_key = ?').all(lastImageKey) as { person_name: string }[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].person_name, 'New Person');
});

// -----------------------------------------------------------
// Querying Tags
// -----------------------------------------------------------

Given('the {string} table contains tags across multiple images', function (_tableName: string) {
  insertTagRow('photo_abc123', 'Jane Smith', 0.9);
  insertTagRow('photo_def456', 'John Doe', 0.75);
  insertTagRow('photo_ghi789', 'Bob', 0.65);
});

Given('{string} is tagged in {string} and {string}', function (personName: string, imageKey1: string, imageKey2: string) {
  insertTagRow(imageKey1, personName, 0.88);
  insertTagRow(imageKey2, personName, 0.82);
});

When('the user queries all photos tagged with {string}', function (personName: string) {
  const rows = db.prepare('SELECT DISTINCT image_key FROM image_tags WHERE person_name = ?').all(personName) as { image_key: string }[];
  lastQueryResult = rows.map(r => r.image_key);
});

Then('the result should include {string} and {string}', function (imageKey1: string, imageKey2: string) {
  assert.ok((lastQueryResult as string[]).includes(imageKey1), `Result should include ${imageKey1}`);
  assert.ok((lastQueryResult as string[]).includes(imageKey2), `Result should include ${imageKey2}`);
});

Then('the result should not include images that only have other people tagged', function () {
  // photo_ghi789 only has Bob, not the queried person
  assert.ok(!(lastQueryResult as string[]).includes('photo_ghi789'));
});

Given('the {string} table has {int} approved tags with uploaded = {int}', function (_tableName: string, count: number, uploaded: number) {
  for (let i = 0; i < count; i++) {
    insertTagRow(`photo_pending_${i}`, 'Person A', 0.8, 1, uploaded);
  }
});

Given('{int} tags with uploaded = {int}', function (count: number, uploaded: number) {
  for (let i = 0; i < count; i++) {
    insertTagRow(`photo_done_${i}`, 'Person B', 0.8, 1, uploaded);
  }
});

When('the system fetches tags pending upload', function () {
  lastQueryResult = db.prepare('SELECT * FROM image_tags WHERE uploaded = 0').all();
});

Then('only the {int} unuploaded tags should be returned', function (count: number) {
  assert.equal((lastQueryResult as unknown[]).length, count);
});

Given('the {string} table has tags with varying confidence scores', function (_tableName: string) {
  insertTagRow('photo_low', 'Person A', 0.45);
  insertTagRow('photo_mid', 'Person B', 0.65);
  insertTagRow('photo_high1', 'Person C', 0.72);
  insertTagRow('photo_high2', 'Person D', 0.90);
});

When('the user filters tags with confidence >= {float}', function (threshold: number) {
  lastQueryResult = db.prepare('SELECT * FROM image_tags WHERE confidence >= ?').all(threshold);
});

Then('only tags with confidence {float} or higher should be returned', function (threshold: number) {
  const rows = lastQueryResult as { confidence: number }[];
  assert.ok(rows.length > 0, 'Should have at least one result');
  for (const row of rows) {
    assert.ok(row.confidence >= threshold, `confidence ${row.confidence} should be >= ${threshold}`);
  }
});

Given('{string} has {int} tag rows: {string} \\(approved) and {string} \\(unapproved)', function (
  imageKey: string, _count: number, approvedPerson: string, unapprovedPerson: string
) {
  insertTagRow(imageKey, approvedPerson, 0.9, 1, 0);
  insertTagRow(imageKey, unapprovedPerson, 0.65, 0, 0);
  lastImageKey = imageKey;
});

When('the system fetches the tag summary for {string}', function (imageKey: string) {
  lastQueryResult = db.prepare('SELECT * FROM image_tags WHERE image_key = ?').all(imageKey);
});

Then('the summary should list both people with their approval and upload status', function () {
  const rows = lastQueryResult as { approved: number; uploaded: number; person_name: string }[];
  assert.equal(rows.length, 2, 'Should have 2 tag rows');
  const approvedRow = rows.find(r => r.approved === 1);
  const unapprovedRow = rows.find(r => r.approved === 0);
  assert.ok(approvedRow, 'Should have one approved row');
  assert.ok(unapprovedRow, 'Should have one unapproved row');
});

// -----------------------------------------------------------
// Data Integrity
// -----------------------------------------------------------

Given('{string} has {int} rows in {string}', function (imageKey: string, rowCount: number, _tableName: string) {
  insertImage(imageKey);
  for (let i = 0; i < rowCount; i++) {
    db.prepare(`
      INSERT INTO image_tags (image_key, person_name, confidence, bbox_x, bbox_y, bbox_w, bbox_h)
      VALUES (?, ?, 0.8, 0, 0, 0.1, 0.1)
    `).run(imageKey, `Person ${i}`);
  }
  lastImageKey = imageKey;
});

When('the image {string} is deleted from the {string} table', function (imageKey: string, _tableName: string) {
  db.prepare('DELETE FROM images WHERE image_key = ?').run(imageKey);
});

Then('the {string} rows for {string} should also be deleted', function (_tableName: string, imageKey: string) {
  const count = (db.prepare('SELECT COUNT(*) as c FROM image_tags WHERE image_key = ?').get(imageKey) as { c: number }).c;
  assert.equal(count, 0, 'Cascaded delete should remove all image_tag rows');
});

Given('{string} has been recognized in {int} photos and stored in {string}', function (personName: string, photoCount: number, _tableName: string) {
  for (let i = 0; i < photoCount; i++) {
    insertTagRow(`photo_person_${i}`, personName, 0.85);
  }
  db.prepare('INSERT OR IGNORE INTO people (name) VALUES (?)').run(personName);
});

When('the person {string} is deleted from the {string} table', function (personName: string, _tableName: string) {
  db.prepare('DELETE FROM people WHERE name = ?').run(personName);
});

Then('the {string} rows for {string} should still exist', function (_tableName: string, personName: string) {
  const count = (db.prepare('SELECT COUNT(*) as c FROM image_tags WHERE person_name = ?').get(personName) as { c: number }).c;
  assert.ok(count > 0, 'image_tags rows should NOT be cascade-deleted when a person is deleted');
});

Then('the person_name column should retain the value {string}', function (personName: string) {
  const rows = db.prepare('SELECT person_name FROM image_tags WHERE person_name = ?').all(personName) as { person_name: string }[];
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.equal(row.person_name, personName);
  }
});
