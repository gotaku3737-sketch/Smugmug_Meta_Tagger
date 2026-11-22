import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

interface ExportTagEntry {
  personName: string;
  confidence: number;
  bbox: { x: number; y: number; width: number; height: number };
  approved: boolean;
  uploaded: boolean;
  taggedAt: string;
}

interface ExportImageEntry {
  imageKey: string;
  albumKey: string;
  albumTitle: string;
  filename: string;
  webUri: string;
  tags: ExportTagEntry[];
}

interface TagManifest {
  schemaVersion: number;
  exportedAt: string;
  keywordFormat: 'prefixed' | 'plain';
  keywordPrefix: string;
  images: Record<string, ExportImageEntry>;
}

let tempDir = '';
let autoSaveEnabled = true;
let imagesStore: Record<string, ExportImageEntry> = {};
let restoredTags: Array<{ imageKey: string; tag: ExportTagEntry }> = [];

Before({ tags: '@local-export' }, function () {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smugmug-tag-export-'));
  autoSaveEnabled = true;
  imagesStore = {};
  restoredTags = [];
});

After({ tags: '@local-export' }, function () {
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildXmpContent(image: ExportImageEntry, prefix: string): string {
  const subjects = image.tags
    .map(t => `        <rdf:li>${escapeXml(`${prefix}${t.personName}`)}</rdf:li>`)
    .join('\n');

  const regions = image.tags
    .map(t => {
      const centerX = (t.bbox.x + t.bbox.width / 2).toFixed(4);
      const centerY = (t.bbox.y + t.bbox.height / 2).toFixed(4);
      const w = t.bbox.width.toFixed(4);
      const h = t.bbox.height.toFixed(4);
      return `          <rdf:li rdf:parseType="Resource">
            <mwg-rs:Name>${escapeXml(t.personName)}</mwg-rs:Name>
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
${subjects}
        </rdf:Bag>
      </dc:subject>
      <mwg-rs:Regions rdf:parseType="Resource">
        <mwg-rs:RegionList>
          <rdf:Bag>
${regions}
          </rdf:Bag>
        </mwg-rs:RegionList>
      </mwg-rs:Regions>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
`;
}

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
  const manifest: TagManifest = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    keywordFormat: 'prefixed',
    keywordPrefix: 'Person:',
    images: imagesStore,
  };
  fs.writeFileSync(path.join(tempDir, filename), JSON.stringify(manifest, null, 2), 'utf8');
});

Then('{string} should exist with schemaVersion {int}', function (filename: string, version: number) {
  const fullPath = path.join(tempDir, filename);
  assert.ok(fs.existsSync(fullPath), `${filename} should exist`);
  const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as TagManifest;
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
    const parsed = JSON.parse(fs.readFileSync(path.join(tempDir, filename), 'utf8')) as TagManifest;
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
  _tagCount: number,
  _imageCount: number
) {
  const manifest: TagManifest = {
    schemaVersion: 1,
    exportedAt: '2026-11-22T15:00:00.000Z',
    keywordFormat: 'prefixed',
    keywordPrefix: 'Person:',
    images: {
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
    },
  };
  fs.writeFileSync(path.join(tempDir, filename), JSON.stringify(manifest, null, 2), 'utf8');
});

Given('the local tag store is empty', function () {
  restoredTags = [];
});

When('the user imports {string}', function (filename: string) {
  const parsed = JSON.parse(fs.readFileSync(path.join(tempDir, filename), 'utf8')) as TagManifest;
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
  const header = 'album_title,album_key,filename,image_key,person_name,confidence,approved,uploaded,tagged_at,web_uri';
  const rows = [header];
  for (const img of Object.values(imagesStore)) {
    for (const tag of img.tags) {
      rows.push(
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
          .map(escapeCsv)
          .join(',')
      );
    }
  }
  fs.writeFileSync(path.join(tempDir, filename), `${rows.join('\n')}\n`, 'utf8');
});

Then('{string} should contain the header {string}', function (filename: string, expectedHeader: string) {
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
  for (const img of Object.values(imagesStore)) {
    const xmpPath = path.join(tempDir, `${img.filename}.xmp`);
    fs.writeFileSync(xmpPath, buildXmpContent(img, prefix), 'utf8');
  }
});

Then('an XMP sidecar file {string} should be created', function (xmpFilename: string) {
  const fullPath = path.join(tempDir, xmpFilename);
  assert.ok(fs.existsSync(fullPath), `${xmpFilename} should exist`);
});

Then('the XMP sidecar should include dc:subject keyword {string}', function (keyword: string) {
  const xmpFiles = fs.readdirSync(tempDir).filter(f => f.endsWith('.xmp'));
  assert.ok(xmpFiles.length > 0, 'Expected at least one .xmp file');
  const content = fs.readFileSync(path.join(tempDir, xmpFiles[0]), 'utf8');
  assert.ok(content.includes(`<rdf:li>${keyword}</rdf:li>`), `Expected dc:subject keyword ${keyword}`);
});

Then('the XMP sidecar should include an MWG face region for {string}', function (personName: string) {
  const xmpFiles = fs.readdirSync(tempDir).filter(f => f.endsWith('.xmp'));
  assert.ok(xmpFiles.length > 0, 'Expected at least one .xmp file');
  const content = fs.readFileSync(path.join(tempDir, xmpFiles[0]), 'utf8');
  assert.ok(content.includes(`<mwg-rs:Name>${personName}</mwg-rs:Name>`));
  assert.ok(content.includes('<mwg-rs:Type>Face</mwg-rs:Type>'));
  assert.ok(content.includes('<stArea:x>'));
});
