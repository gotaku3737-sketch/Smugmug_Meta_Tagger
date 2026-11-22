import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TagManifestEntry, TagManifestImageEntry } from '../../src/shared/types';
import {
  CSV_HEADER,
  exportTagsToCsv,
  exportTagsToXmp,
  readTagManifest,
  serializeTagManifest,
  writeTagManifest,
} from '../../src/main/services/tag-exporter';

let tempDir = '';
let autoSaveEnabled = true;
let imagesStore: Record<string, TagManifestImageEntry> = {};
let restoredTags: Array<{ imageKey: string; tag: TagManifestEntry }> = [];
let writtenXmpPaths: string[] = [];

Before({ tags: '@local-export' }, function () {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smugmug-tag-export-'));
  autoSaveEnabled = true;
  imagesStore = {};
  restoredTags = [];
  writtenXmpPaths = [];
});

After({ tags: '@local-export' }, function () {
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------
// JSON Manifest Auto-Save & Re-Import
// -----------------------------------------------------------

Given('auto-save tag manifest is enabled', function () {
  autoSaveEnabled = true;
});

Given(
  'an album {string} \\({string}) has an image {string} \\({string})',
  function (albumTitle: string, albumKey: string, imageKey: string, filename: string) {
    imagesStore[imageKey] = {
      imageKey,
      albumKey,
      albumTitle,
      filename,
      webUri: `https://example.smugmug.com/${albumKey}/i-${imageKey}`,
      tags: [],
    };
  }
);

Given(
  '{string} has an approved tag for {string} with confidence {float} and bounding box {float}, {float}, {float}, {float}',
  function (
    imageKey: string,
    personName: string,
    confidence: number,
    x: number,
    y: number,
    width: number,
    height: number
  ) {
    const img = imagesStore[imageKey];
    assert.ok(img, `Image ${imageKey} should exist`);
    img.tags.push({
      personName,
      confidence,
      bbox: { x, y, width, height },
      approved: true,
      uploaded: false,
      taggedAt: '2026-11-22T15:00:00.000Z',
    });
  }
);

When('the local tag manifest is synced to {string}', function (filename: string) {
  assert.equal(autoSaveEnabled, true);
  const manifest = serializeTagManifest(imagesStore, {
    keywordFormat: 'prefixed',
    keywordPrefix: 'Person:',
  });
  writeTagManifest(path.join(tempDir, filename), manifest);
});

Then('{string} should exist with schemaVersion {int}', function (filename: string, version: number) {
  const fullPath = path.join(tempDir, filename);
  assert.ok(fs.existsSync(fullPath), `${filename} should exist`);
  const parsed = readTagManifest(fullPath);
  assert.equal(parsed.schemaVersion, version);
});

Then(
  '{string} should record {string} for {string} with approved true and bounding box {float}, {float}, {float}, {float}',
  function (
    filename: string,
    personName: string,
    imageKey: string,
    x: number,
    y: number,
    width: number,
    height: number
  ) {
    const parsed = readTagManifest(path.join(tempDir, filename));
    const img = parsed.images[imageKey];
    assert.ok(img, `Image ${imageKey} should be present in manifest`);
    const tag = img.tags.find(t => t.personName === personName);
    assert.ok(tag, `Tag for ${personName} should be present`);
    assert.equal(tag.approved, true);
    assert.deepEqual(tag.bbox, { x, y, width, height });
  }
);

Given('a valid {string} manifest exists with {int} tagged people across {int} images', function (
  filename: string,
  tagCount: number,
  imageCount: number
) {
  const images: Record<string, TagManifestImageEntry> = {
    photo_1: {
      imageKey: 'photo_1',
      albumKey: 'album_1',
      albumTitle: 'Trip',
      filename: 'IMG_0001.JPG',
      webUri: 'https://example.smugmug.com/album_1/i-photo_1',
      tags: [
        {
          personName: 'Jane Smith',
          confidence: 0.91,
          bbox: { x: 0.1, y: 0.2, width: 0.2, height: 0.25 },
          approved: true,
          uploaded: true,
          taggedAt: '2026-11-22T14:00:00.000Z',
        },
      ],
    },
    photo_2: {
      imageKey: 'photo_2',
      albumKey: 'album_1',
      albumTitle: 'Trip',
      filename: 'IMG_0002.JPG',
      webUri: 'https://example.smugmug.com/album_1/i-photo_2',
      tags: [
        {
          personName: 'John Doe',
          confidence: 0.78,
          bbox: { x: 0.3, y: 0.15, width: 0.18, height: 0.22 },
          approved: false,
          uploaded: false,
          taggedAt: '2026-11-22T14:05:00.000Z',
        },
      ],
    },
  };
  assert.equal(Object.keys(images).length, imageCount);
  const totalTags = Object.values(images).reduce((sum, img) => sum + img.tags.length, 0);
  assert.equal(totalTags, tagCount);

  const manifest = serializeTagManifest(images, {
    keywordFormat: 'prefixed',
    keywordPrefix: 'Person:',
    exportedAt: '2026-11-22T15:00:00.000Z',
  });
  writeTagManifest(path.join(tempDir, filename), manifest);
});

Given('the local tag store is empty', function () {
  restoredTags = [];
});

When('the user imports {string}', function (filename: string) {
  const parsed = readTagManifest(path.join(tempDir, filename));
  assert.equal(parsed.schemaVersion, 1, 'Manifest schemaVersion must be 1');
  for (const [imageKey, img] of Object.entries(parsed.images)) {
    for (const tag of img.tags) {
      restoredTags.push({ imageKey, tag });
    }
  }
});

Then('the local tag store should contain all {int} restored tag records with their approval and upload status', function (
  expectedCount: number
) {
  assert.equal(restoredTags.length, expectedCount);
  const jane = restoredTags.find(r => r.tag.personName === 'Jane Smith');
  const john = restoredTags.find(r => r.tag.personName === 'John Doe');
  assert.ok(jane && jane.tag.approved === true && jane.tag.uploaded === true);
  assert.ok(john && john.tag.approved === false && john.tag.uploaded === false);
});

// -----------------------------------------------------------
// CSV Export
// -----------------------------------------------------------

When('the user exports tags to CSV {string}', function (filename: string) {
  exportTagsToCsv(path.join(tempDir, filename), imagesStore);
});

Then('{string} should contain the header {string}', function (filename: string, expectedHeader: string) {
  assert.equal(expectedHeader, CSV_HEADER);
  const lines = fs.readFileSync(path.join(tempDir, filename), 'utf8').trim().split('\n');
  assert.equal(lines[0], expectedHeader);
});

Then('{string} should include a row for {string} and {string}', function (
  filename: string,
  imageKey: string,
  personName: string
) {
  const lines = fs.readFileSync(path.join(tempDir, filename), 'utf8').trim().split('\n').slice(1);
  const matching = lines.find(line => line.includes(imageKey) && line.includes(personName));
  assert.ok(matching, `Expected CSV row containing ${imageKey} and ${personName}`);
});

// -----------------------------------------------------------
// XMP Sidecar Export
// -----------------------------------------------------------

When('the user exports XMP sidecar files with prefix {string}', function (prefix: string) {
  writtenXmpPaths = exportTagsToXmp(tempDir, imagesStore, {
    mode: 'prefixed',
    prefix,
    organizeByAlbum: true,
  });
});

Then('an XMP sidecar file {string} should be created', function (xmpFilename: string) {
  const matchedPath = writtenXmpPaths.find(
    p => path.basename(p) === xmpFilename && fs.existsSync(p)
  );
  assert.ok(matchedPath, `${xmpFilename} should be created`);
});

Then('the XMP sidecar should include dc:subject keyword {string}', function (keyword: string) {
  assert.ok(writtenXmpPaths.length > 0, 'Expected at least one .xmp file');
  const content = fs.readFileSync(writtenXmpPaths[0], 'utf8');
  assert.ok(content.includes(`<rdf:li>${keyword}</rdf:li>`), `Expected dc:subject keyword ${keyword}`);
});

Then('the XMP sidecar should include an MWG face region for {string}', function (personName: string) {
  assert.ok(writtenXmpPaths.length > 0, 'Expected at least one .xmp file');
  const content = fs.readFileSync(writtenXmpPaths[0], 'utf8');
  assert.ok(content.includes(`<mwg-rs:Name>${personName}</mwg-rs:Name>`));
  assert.ok(content.includes('<mwg-rs:Type>Face</mwg-rs:Type>'));
  assert.ok(content.includes('<stArea:x>'));
});
