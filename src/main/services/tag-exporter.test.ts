import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TagManifestImageEntry } from '../../shared/types';
import {
  CSV_HEADER,
  TAG_MANIFEST_SCHEMA_VERSION,
  escapeCsvCell,
  exportTagsToCsv,
  exportTagsToXmp,
  parseTagManifest,
  readTagManifest,
  sanitizePathSegment,
  serializeImageToXmp,
  serializeTagManifest,
  serializeTagsToCsv,
  writeTagManifest,
} from './tag-exporter';

function withTempDir(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tag-exporter-test-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const sampleImages: Record<string, TagManifestImageEntry> = {
  photo_1: {
    imageKey: 'photo_1',
    albumKey: 'album_xyz',
    albumTitle: 'Hawaii, 2026',
    filename: 'IMG_0042.JPG',
    webUri: 'https://example.smugmug.com/Hawaii-2026/i-photo_1',
    tags: [
      {
        personName: 'Jane Smith',
        confidence: 0.85,
        bbox: { x: 0.12, y: 0.18, width: 0.22, height: 0.3 },
        approved: true,
        uploaded: true,
        taggedAt: '2026-11-22T14:55:00.000Z',
      },
      {
        personName: 'O\'Connor & "Bob"',
        confidence: 0.72,
        bbox: { x: 0.5, y: 0.2, width: 0.1, height: 0.15 },
        approved: false,
        uploaded: false,
        taggedAt: '2026-11-22T14:56:00.000Z',
      },
    ],
  },
};

describe('TagExporter', () => {
  test('serializeTagManifest / writeTagManifest / readTagManifest round-trip', () => {
    withTempDir((dir) => {
      const target = path.join(dir, 'nested', 'tags.json');
      const manifest = serializeTagManifest(sampleImages, {
        keywordFormat: 'prefixed',
        keywordPrefix: 'Person:',
        exportedAt: '2026-11-22T15:00:00.000Z',
      });
      writeTagManifest(target, manifest);

      const loaded = readTagManifest(target);
      assert.equal(loaded.schemaVersion, TAG_MANIFEST_SCHEMA_VERSION);
      assert.equal(loaded.exportedAt, '2026-11-22T15:00:00.000Z');
      assert.deepEqual(loaded.images.photo_1, sampleImages.photo_1);

      if (process.platform !== 'win32') {
        const mode = fs.statSync(target).mode & 0o777;
        assert.equal(mode, 0o600);
      }
    });
  });

  test('parseTagManifest rejects malformed JSON, bad schemaVersion, and invalid tags', () => {
    assert.throws(() => parseTagManifest('not json'), /Invalid JSON manifest/);
    assert.throws(
      () => parseTagManifest(JSON.stringify({ schemaVersion: 2, images: {} })),
      /Unsupported manifest schemaVersion/
    );
    assert.throws(
      () =>
        parseTagManifest(
          JSON.stringify({
            schemaVersion: 1,
            images: {
              img1: {
                imageKey: 'img1',
                tags: [{ personName: '', confidence: 0.8 }],
              },
            },
          })
        ),
      /Invalid personName/
    );
  });

  test('escapeCsvCell and exportTagsToCsv quote commas and quotes per RFC 4180', () => {
    assert.equal(escapeCsvCell('simple'), 'simple');
    assert.equal(escapeCsvCell('Hawaii, 2026'), '"Hawaii, 2026"');
    assert.equal(escapeCsvCell('Say "Hi"'), '"Say ""Hi"""');

    const csv = serializeTagsToCsv(sampleImages);
    const lines = csv.trim().split('\n');
    assert.equal(lines[0], CSV_HEADER);
    assert.equal(lines.length, 3);
    assert.ok(lines[1].startsWith('"Hawaii, 2026",album_xyz,IMG_0042.JPG,photo_1,Jane Smith,0.85,true,true,'));
    assert.ok(lines[2].includes('"O\'Connor & ""Bob"""'));

    withTempDir((dir) => {
      const csvPath = path.join(dir, 'exports', 'smugmug_tags.csv');
      const count = exportTagsToCsv(csvPath, sampleImages);
      assert.equal(count, 2);
      assert.ok(fs.existsSync(csvPath));
    });
  });

  test('escapeCsvCell neutralizes spreadsheet formula injection', () => {
    assert.equal(escapeCsvCell('=SUM(A1)'), "'=SUM(A1)");
    assert.equal(escapeCsvCell('+cmd'), "'+cmd");
    assert.equal(escapeCsvCell('-1+1'), "'-1+1");
    assert.equal(escapeCsvCell('@SUM'), "'@SUM");
    assert.equal(escapeCsvCell('\t=1'), "'\t=1");
    assert.equal(escapeCsvCell('\r=1'), '"\'\r=1"');
    assert.equal(escapeCsvCell('=1,2'), '"\'=1,2"');
    assert.equal(escapeCsvCell('normal text'), 'normal text');
  });

  test('serializeImageToXmp emits dc:subject, MWG center coords, and XML escapes', () => {
    const xmpPrefixed = serializeImageToXmp(sampleImages.photo_1, {
      mode: 'prefixed',
      prefix: 'Family:',
    });
    assert.ok(xmpPrefixed.includes('<rdf:li>Family:Jane Smith</rdf:li>'));
    assert.ok(xmpPrefixed.includes('<rdf:li>Family:O&apos;Connor &amp; &quot;Bob&quot;</rdf:li>'));
    assert.ok(xmpPrefixed.includes('<mwg-rs:Name>Jane Smith</mwg-rs:Name>'));
    assert.ok(xmpPrefixed.includes('<mwg-rs:Type>Face</mwg-rs:Type>'));
    // Center of bbox (0.12 + 0.22/2 = 0.2300, 0.18 + 0.30/2 = 0.3300)
    assert.ok(xmpPrefixed.includes('<stArea:x>0.2300</stArea:x>'));
    assert.ok(xmpPrefixed.includes('<stArea:y>0.3300</stArea:y>'));
    assert.ok(xmpPrefixed.includes('<stArea:w>0.2200</stArea:w>'));
    assert.ok(xmpPrefixed.includes('<stArea:h>0.3000</stArea:h>'));

    const xmpPlain = serializeImageToXmp(sampleImages.photo_1, { mode: 'plain' });
    assert.ok(xmpPlain.includes('<rdf:li>Jane Smith</rdf:li>'));
  });

  test('exportTagsToXmp organizes by sanitized albumKey and prevents path traversal', () => {
    assert.equal(sanitizePathSegment('..'), '_..');
    assert.equal(sanitizePathSegment('.'), '_.');
    assert.equal(sanitizePathSegment('../evil/name'), '.._evil_name');

    withTempDir((dir) => {
      const evilImages: Record<string, TagManifestImageEntry> = {
        evil_1: {
          imageKey: 'evil_1',
          albumKey: '../outside',
          albumTitle: 'Evil',
          filename: '..',
          webUri: '',
          tags: [
            {
              personName: 'Jane Smith',
              confidence: 0.9,
              bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
              approved: true,
              uploaded: false,
              taggedAt: '2026-11-22T15:00:00.000Z',
            },
          ],
        },
      };

      const written = exportTagsToXmp(dir, evilImages, { mode: 'prefixed', prefix: 'Person:' });
      assert.equal(written.length, 1);
      const resolvedDir = path.resolve(dir);
      const resolvedFile = path.resolve(written[0]);
      assert.ok(resolvedFile.startsWith(resolvedDir + path.sep));
      assert.equal(path.basename(resolvedFile), '_...xmp');
      assert.ok(fs.existsSync(resolvedFile));

      if (process.platform !== 'win32') {
        const mode = fs.statSync(resolvedFile).mode & 0o777;
        assert.equal(mode, 0o600);
      }
    });
  });
});
