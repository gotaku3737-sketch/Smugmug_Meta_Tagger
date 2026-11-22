# Implementation Plan: SmugMug Tagging & Local Tag Persistence

This plan defines the architecture and phased implementation for two complementary tagging capabilities in **SmugMug Meta Tagger**:

1. **SmugMug Cloud Tagging** — Keep SmugMug `Keywords` as the primary cloud target with configurable keyword formatting (default `Person:Name`, plain `Name`, or custom prefix) so photos work natively with SmugMug search and Smart Galleries.
2. **Local Saved File Persistence & Export** — Maintain an auto-saved portable JSON manifest (`tags.json`) for backup/re-import and offline review, plus on-demand **CSV** and **XMP sidecar** exports for spreadsheets and photo managers (Lightroom, DigiKam, Darktable).

All behaviors below are aligned with the Spec-Driven Development (BDD) specifications in `tests/features/`.

---

## Part 1: SmugMug Keyword Tagging (Configurable Format)

### Goals
- Keep `PATCH /api/v2/image/{imageKey}` writing to SmugMug's `Keywords` field as the primary cloud target.
- Allow users to choose how person names are formatted in `Keywords`:
  - **Prefixed (default):** `Person:Jane Smith` (cleanly distinguishable from non-person keywords; works well with SmugMug Smart Gallery rules).
  - **Plain name:** `Jane Smith` (cleaner for casual natural-language search in SmugMug).
  - **Custom prefix:** e.g. `Family:Jane Smith` or `Face:Jane Smith`.
- Always preserve existing non-person keywords and avoid duplicating person tags on re-upload.
- Maintain the 200ms inter-request delay and exponential backoff on HTTP 429/5xx.

### Settings & Shared Helpers
- Extend `AppSettings` in `src/shared/types.ts`:
  ```ts
  export type KeywordFormatMode = 'prefixed' | 'plain';

  export interface AppSettings {
    recognitionThreshold: number;   // 0.4 - 0.8, default 0.6
    concurrentDownloads: number;    // default 5
    dataDirectory: string;
    keywordFormat: KeywordFormatMode; // default 'prefixed'
    keywordPrefix: string;            // default 'Person:' (used when keywordFormat === 'prefixed')
    autoSaveTagManifest: boolean;     // default true
  }
  ```
- Update `formatPersonKeyword`, `parsePersonKeywords`, and `mergeKeywords` in `src/shared/types.ts` to accept format options (`mode`, `prefix`, and known `previousPersonNames` when running in `plain` mode so old plain-name tags can be cleanly replaced without touching unrelated keywords).
- Expose keyword format controls in `src/renderer/pages/SettingsPage.tsx` with a live preview (e.g., `Person:Jane Smith; vacation; hawaii` vs `Jane Smith; vacation; hawaii`).

### SmugMug Smart Galleries Note
- Because SmugMug does not have a separate "label" field distinct from `Keywords`, using `Person:Name` (or plain `Name`) allows users to create SmugMug **Smart Galleries** that automatically collect all photos matching a given person keyword without duplicating image files.

### Aligned BDD Spec
- `tests/features/tag_upload.feature` (`tests/step_defs/tag_steps.ts`)
  - Uploading tags using default `Person:Name` format.
  - Uploading tags using plain `Name` format.
  - Uploading tags using a custom prefix (e.g., `Family:Name`).
  - Preserving existing non-person keywords, applying the 200ms rate-limit delay, and updating local DB status.

---

## Part 2: Local Saved Tag Files (JSON Manifest + CSV & XMP Exports)

### Goals
- Provide a human-readable, portable local record of all recognized/approved/uploaded tags alongside `smugmug_tagger.db`.
- Preserve face bounding boxes (`bbox_x`, `bbox_y`, `bbox_w`, `bbox_h`) that SmugMug's `Keywords` field discards.
- Support backup/restore across machine migrations or database resets.
- Support interoperability with external tools (Excel/Sheets via CSV; Lightroom/DigiKam/Darktable via XMP sidecars).

### 2A. Auto-Saved Portable JSON Manifest (`tags.json`)
- **Location:** `{dataDirectory}/tags.json`
- **Trigger:** Automatically synced whenever tags are saved by the Auto-Tagger, manually approved, or marked uploaded to SmugMug (when `autoSaveTagManifest` is enabled in Settings), and available on demand via **Export → JSON Manifest**.
- **Schema (`schemaVersion: 1`):**
  ```json
  {
    "schemaVersion": 1,
    "exportedAt": "2026-11-22T15:00:00.000Z",
    "keywordFormat": "prefixed",
    "keywordPrefix": "Person:",
    "images": {
      "photo_abc123": {
        "imageKey": "photo_abc123",
        "albumKey": "album_xyz",
        "albumTitle": "Hawaii 2026",
        "filename": "IMG_0042.JPG",
        "webUri": "https://user.smugmug.com/Hawaii-2026/i-photo_abc123",
        "tags": [
          {
            "personName": "Jane Smith",
            "confidence": 0.85,
            "bbox": { "x": 0.12, "y": 0.18, "width": 0.22, "height": 0.30 },
            "approved": true,
            "uploaded": true,
            "taggedAt": "2026-11-22T14:55:00.000Z"
          }
        ]
      }
    }
  }
  ```
- **Re-Import:** Importing a `tags.json` file validates `schemaVersion` and restores rows into `image_tags` (matching by `image_key`), preserving `approved`, `uploaded`, `confidence`, and bounding boxes.

### 2B. CSV Export (`smugmug_tags.csv`)
- **Location:** User-chosen path or `{dataDirectory}/exports/smugmug_tags.csv`
- **Columns:**
  `album_title,album_key,filename,image_key,person_name,confidence,approved,uploaded,tagged_at,web_uri`
- Properly escapes commas and quotes per RFC 4180 so it opens cleanly in Excel / Google Sheets for bulk auditing.

### 2C. XMP Sidecar Export (`{filename}.xmp`)
- **Location:** `{dataDirectory}/exports/xmp/{albumKey}/{filename}.xmp` (or user-selected directory)
- **Contents:**
  - Standard RDF/XMP envelope (`x:xmpmeta` / `rdf:RDF`)
  - `dc:subject` (`rdf:Bag`) containing the formatted person keywords
  - `mwg-rs:Regions` (`mwg-rs:RegionList`) encoding each tagged face with `mwg-rs:Name`, `mwg-rs:Type="Face"`, and normalized `stArea:x`, `stArea:y`, `stArea:w`, `stArea:h` center/size coordinates.
- Compatible with Adobe Lightroom, DigiKam, Darktable, and ExifTool.

### New Service & IPC Touchpoints
- `src/main/services/tag-exporter.ts` — Pure serialization + file I/O helpers:
  - `serializeTagManifest(...)` / `writeTagManifest(...)` / `importTagManifest(...)`
  - `serializeTagsToCsv(...)` / `exportTagsToCsv(...)`
  - `serializeImageToXmp(...)` / `exportTagsToXmp(...)`
- `src/main/ipc-handlers.ts` & `src/main/preload.ts` & `src/shared/types.ts`:
  - `tags.exportManifest(targetPath?)`
  - `tags.importManifest(sourcePath)`
  - `tags.exportCsv(targetPath?)`
  - `tags.exportXmp(targetDir?, albumKey?)`
- `src/renderer/pages/AutoTagger.tsx` & `src/renderer/pages/SettingsPage.tsx`:
  - Add Export/Import actions (`Export JSON`, `Export CSV`, `Export XMP`, `Import JSON`) and the `Auto-save local tags.json` toggle.

### Aligned BDD Spec
- `tests/features/local_tag_storage.feature` (`tests/step_defs/local_tag_storage_steps.ts`) — Normalized SQLite `image_tags` storage, querying, and integrity.
- `tests/features/local_tag_export.feature` (`tests/step_defs/local_tag_export_steps.ts`) — JSON manifest auto-save & re-import, CSV export, and XMP sidecar generation with MWG face regions.

---

## Phased Rollout

| Phase | Scope | Verification |
|-------|-------|--------------|
| **Phase 1: Specs & Docs** | Update `README.md`, create `plan.md`, align `tag_upload.feature` and add `local_tag_export.feature` + step definitions | `npm run test:bdd` |
| **Phase 2: Keyword Format Config** | Extend `AppSettings`, update `mergeKeywords` helpers + unit tests, wire into `SettingsPage` and upload handler | `npm test` + `tag_upload.feature` |
| **Phase 3: Local Manifest & Exports** | Implement `src/main/services/tag-exporter.ts`, wire auto-save hook on tag mutations, add IPC handlers & UI export/import buttons | `local_tag_export.feature` + manual E2E check |
