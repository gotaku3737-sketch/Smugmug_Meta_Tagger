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

## Phased Rollout (v1 — Completed)

| Phase | Scope | Status | Verification |
|-------|-------|--------|--------------|
| **Phase 1: Specs & Docs** | Update `README.md`, create `plan.md`, align `tag_upload.feature` and add `local_tag_export.feature` + step definitions | **Completed** (`17f9344`) | `npm run test:bdd` |
| **Phase 2: Keyword Format Config** | Extend `AppSettings`, update `mergeKeywords` helpers + unit tests, wire into `SettingsPage` and upload handler | **Completed** (`a608187`) | `npm test` + `tag_upload.feature` |
| **Phase 3: Local Manifest & Exports** | Implement `src/main/services/tag-exporter.ts`, wire auto-save hook on tag mutations, add IPC handlers & UI export/import buttons | **Completed** (`62cf424`) | `local_tag_export.feature` + manual E2E check |

---

## Roadmap v2: Privacy, Security Hardening & Reliability

**Target Audience & Distribution Model:** Personal / single-user desktop tool for managing your own SmugMug library (open-sourced as bring-your-own SmugMug API key for technical users). All face processing remains 100% local on-device.

---

### Part 3: Cloud & Local Privacy Controls (Phase 4)

#### SmugMug Album Privacy Guardrails
- **Track Album Visibility:** Fetch and persist each album's SmugMug visibility (`Privacy` / `SecurityType` — e.g., `Public`, `Unlisted`, `Private`) in `src/main/services/smugmug-api.ts` and the `albums` table in `src/main/services/database.ts`.
- **UI Warnings & Confirmation:** Display privacy badges (`Public`, `Unlisted`, `Private`) on album cards in `src/renderer/pages/GalleryBrowser.tsx` and on matched items in `src/renderer/pages/AutoTagger.tsx`. Require explicit confirmation before uploading real person names to `Public` or `Unlisted` galleries, where keywords become publicly visible and searchable.
- **Local-Only Tagging Option:** Allow marking specific people or albums as local-only (saved in SQLite, `tags.json`, CSV, and XMP sidecars, but excluded from SmugMug `PATCH` uploads).

#### Local Biometric & Cache Lifecycle
- **At-Rest Protection Model:** Rely on OS full-disk encryption (FileVault / BitLocker / LUKS) combined with strict `0o600` file and `0o700` directory permissions under `{dataDirectory}`.
- **Optional Cache Auto-Purge:** Add a setting to automatically delete cached `medium/` (~800px) images after face scanning completes (unlocked by persisting face descriptors in Phase 6).
- **Consistent Cleanup & Deletion (`clearTrainingData`, `resetDatabase`, `disconnect`):**
  - Update `clearTrainingData()` in `src/main/services/database.ts` (and `src/main/ipc-handlers.ts`) so it also clears `image_tags` and re-syncs/clears `tags.json` rather than leaving stale tag rows behind.
  - Ensure `resetDatabase()` cleans up cached local files (`thumbnails/`, `medium/`, `tags.json`, `exports/`) or clearly separates DB reset from full local data wipe.
  - Update `disconnect()` in `src/main/services/oauth.ts` to offer an option (or clear behavior) for wiping `consumerKey` / `consumerSecret` alongside OAuth access tokens.
- **"Forget Person" Action:** Add a dedicated action in the UI/backend to remove a person's `face_descriptors`, `image_tags`, and `detected_people` entries, re-sync `tags.json`, and optionally strip their keyword from SmugMug photos.

---

### Part 4: Security Hardening (Phase 5)

#### Credential Storage (`src/main/services/oauth.ts`)
- **Eliminate Silent Plaintext Fallback:** Remove the silent `plain:` prefix fallback when `safeStorage.isEncryptionAvailable()` returns `false`. Fail closed by default (surface a clear error to the user), or require an explicit, prominent user opt-in before storing unencrypted credentials on systems without an OS keyring.

#### Network & CSP Lockdown (`src/main/index.ts`, `src/main/services/oauth.ts`)
- **Bundle UI Fonts Locally:** Replace external Google Fonts references (`https://fonts.googleapis.com` / `https://fonts.gstatic.com`) with locally bundled font assets so launching the app makes zero third-party requests.
- **Tighten Content-Security-Policy:** Restrict `style-src`, `font-src`, `img-src`, and `connect-src` in `src/main/index.ts` to remove external font origins and overly broad `https:` directives where local/SmugMug-only origins suffice.
- **Download Redirect Allowlist:** Restrict HTTP redirects in `OAuthService.downloadFile()` (`src/main/services/oauth.ts`) to an explicit SmugMug domain allowlist (e.g., `*.smugmug.com`) instead of allowing arbitrary HTTPS redirect targets.

#### IPC & Export Hardening (`src/main/ipc-handlers.ts`, `src/main/services/tag-exporter.ts`)
- **IPC Input Validation:** Validate argument types, string lengths, and bounds on all IPC handlers in `src/main/ipc-handlers.ts` (e.g., `imageKeys`, `albumKey`, `personName`, `bbox`, `settings` updates).
- **Enforce Approval Before Upload:** Update `tags:uploadTags` to enforce `approved === 1` in `image_tags` rather than relying solely on renderer-side selection state.
- **CSV Formula-Injection Neutralization:** Update `escapeCsvCell()` in `src/main/services/tag-exporter.ts` to neutralize leading formula characters (`=`, `+`, `-`, `@`, `\t`, `\r`) before quoting so exported CSV files are safe to open in Excel or Google Sheets.

---

### Part 5: SmugMug Sync Safety & Face-Engine Reliability (Phase 6)

#### Prevent Stale Keyword Overwrites & Support Incremental Sync (`src/main/services/smugmug-api.ts`, `src/main/ipc-handlers.ts`)
- **Fetch Fresh Keywords Before PATCH:** Query the image's current `Keywords` from SmugMug right before sending `PATCH /api/v2/image/{imageKey}` so keywords added or edited on SmugMug after initial sync are never clobbered.
- **Incremental Album Refresh:** Update `albums:getImages` (or add an explicit refresh path) to fetch newly added photos in already-synced albums and merge updates into SQLite without losing local face/tag state.

#### Persist Detected Face Descriptors (`src/main/services/database.ts`, `src/main/services/face-engine.ts`)
- **New `detected_faces` Table:** Store each detected face's bounding box and 128-dim descriptor during `detectInAlbum()`.
- **Instant Auto-Tagging & Re-Matching:** Update `runAutoTagger()` to match directly against persisted `detected_faces` rows instead of re-loading images and re-running SSD MobileNet v1 detection. This enables near-instant re-matching when new people are trained and allows purging `medium/` image caches safely.

#### Training Integrity & Upload Diff Preview (`src/main/services/face-engine.ts`, `src/main/ipc-handlers.ts`, `src/renderer/pages/AutoTagger.tsx`)
- **Reject Zero-Vector Training Fallbacks:** Remove the silent `new Float32Array(128)` zero-descriptor fallback when face detection fails in `trainFace()` / `faces:trainFace`; instead warn the user and reject the sample so `FaceMatcher` accuracy is not degraded.
- **Upload Dry-Run / Diff Preview:** Show a before/after `Keywords` diff preview in `AutoTagger.tsx` before sending `PATCH` requests to SmugMug.

#### Packaging & Repo Hygiene (`forge.config.ts`, `src/main/index.ts`, `package.json`)
- **Packaged Model Paths & Native Modules:** Configure `models/` via `packagerConfig.extraResource` in `forge.config.ts` and resolve via `process.resourcesPath` when `app.isPackaged` in `src/main/index.ts`; verify native module unpacking (`better-sqlite3`, `@napi-rs/canvas`, `@tensorflow/tfjs-node`) under `npm run package` / `npm run make`.
- **Repository Cleanup:** Remove unused `dummy.txt` from the repository root and review `package.json` metadata (`author.email`) prior to public releases.

---

### Phased Rollout (v2 — Completed)

| Phase | Scope | Status | Verification |
|-------|-------|--------|--------------|
| **Phase 4: Privacy Controls** | Album privacy tracking & upload warnings, local-only tag mode, optional `medium/` cache purge, consistent `clearTrainingData`/`resetDatabase`/`disconnect`, "Forget Person" workflow | **Completed** | `npx tsc --noEmit` + `npm test` + `npm run lint` |
| **Phase 5: Security Hardening** | Remove silent `plain:` token fallback, bundle fonts locally & tighten CSP, SmugMug download redirect allowlist, IPC validation, approved-only upload enforcement, CSV formula neutralization | **Completed** | `npx tsc --noEmit` + `npm test` + `npm run lint` |
| **Phase 6: Sync Safety, Face DB & Packaging** | Fresh-keyword fetch pre-PATCH, incremental album refresh, `detected_faces` table, reject zero-vector training fallback, upload diff preview, Forge `extraResource` models + repo hygiene | **Completed** | `npx tsc --noEmit` + `npm test` + `npm run lint` |
