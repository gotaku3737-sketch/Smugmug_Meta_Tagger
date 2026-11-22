# SmugMug Meta Tagger

> An Electron desktop app that uses face recognition to automatically tag people in your SmugMug photo library.

![Electron](https://img.shields.io/badge/Electron-41-47848F?style=flat&logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178C6?style=flat&logo=typescript&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003B57?style=flat&logo=sqlite&logoColor=white)

---

## Overview

SmugMug Meta Tagger connects to your SmugMug account, downloads photos at a manageable resolution, and lets you train a face recognition model by labeling people. Once trained, it automatically identifies those people across all your galleries and uploads `Person:Name` keywords back to SmugMug — making your entire library searchable by face.

### Key Features

- 🔑 **OAuth 1.0a authentication** with SmugMug's API v2 (credentials encrypted at rest via OS keychain)
- 📸 **Tiered photo download** — thumbnails for browsing, medium-res (~800px) for face detection; full-res never required
- 🔍 **Face detection** powered by `face-api.js` (SSD MobileNet v1 + 68-point landmarks + 128-dim embeddings)
- 🎓 **Interactive face trainer** — click on detected faces and assign a name; 3+ samples per person recommended
- 🤖 **Auto-tagger** — runs recognition across all scanned photos, shows confidence scores, lets you approve before uploading
- 🏷️ **Configurable SmugMug keyword upload** — writes `Person:Name` (default), plain `Name`, or a custom prefix to SmugMug `Keywords`, preserving all existing non-person keywords and working natively with SmugMug search and Smart Galleries
- 💾 **Local SQLite database + portable file exports** — tracks albums, images, face descriptors, and tag upload status in SQLite, auto-saves a portable `tags.json` manifest (with backup/re-import), and supports CSV and XMP sidecar (with MWG face regions) exports
- ⚡ **Performance** — virtualised result lists, parallel downloads (5 concurrent), batch face processing with event-loop yields

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop Framework | Electron 41 + Electron Forge |
| Build Tool | Vite 5 + TypeScript 5.4 |
| Frontend | React 19 |
| Styling | Vanilla CSS (dark theme, glassmorphism) |
| SmugMug Auth | OAuth 1.0a (`oauth-1.0a`) |
| Face Detection | `@vladmandic/face-api` + TensorFlow.js Node |
| Canvas (Node.js) | `@napi-rs/canvas` |
| Local Database | `better-sqlite3` (SQLite) |
| Credential Storage | Electron `safeStorage` (OS keychain) |

---

## Prerequisites

- **Node.js** ≥ 18 (tested on 25.x)
- **npm** ≥ 9
- A **SmugMug account** with API access
- A **SmugMug API application** — register at [api.smugmug.com](https://api.smugmug.com/api/developer/apply)

---

## Installation

```bash
# Clone the repository
git clone https://github.com/your-username/Smugmug_Meta_Tagger.git
cd Smugmug_Meta_Tagger

# Install dependencies
npm install
```

> **Note:** The `models/` directory containing face-api.js model weights (~12 MB) is included in the repository. No additional download is needed.

---

## Running in Development

```bash
npm start
```

This launches the app in development mode with:
- Vite dev server for the React renderer (hot module replacement)
- Electron DevTools open automatically

---

## Building for Distribution

```bash
# Package the app (no installer)
npm run package

# Create platform-specific installers
npm run make
```

Output is placed in the `out/` directory.

| Platform | Output |
|----------|--------|
| macOS | `.zip` archive |
| Windows | Squirrel installer (`.exe`) |
| Linux | `.deb` and `.rpm` packages |

---

## First-Time Setup

### 1. Obtain SmugMug API Credentials

1. Go to [api.smugmug.com](https://api.smugmug.com/api/developer/apply) and create an application
2. Note your **API Key** (Consumer Key) and **API Secret** (Consumer Secret)

### 2. Connect the App

1. Launch the app (`npm start`)
2. On the **Connect** page, enter your API Key and API Secret
3. Click **Connect to SmugMug** — your browser will open the SmugMug authorization page
4. Authorize the app, copy the **6-digit verifier code** shown by SmugMug
5. Paste the code back into the app and click **Complete Authorization**

Your credentials are encrypted and stored locally — you won't need to repeat this.

---

## Workflow

```
Sync Albums  →  Download Thumbnails  →  Scan for Faces  →  Label Faces  →  Run Auto-Tagger  →  Upload Tags
```

### Step-by-Step

#### 1. Sync Albums
On the **Galleries** page, click **Sync Albums** to fetch your full SmugMug library. Album metadata (title, image count) is stored in the local database.

#### 2. Download Thumbnails
Click **Download** on any album card. Small thumbnails (~150px) are saved locally for display — fast and lightweight.

#### 3. Scan for Faces
Click **Scan Faces** on an album. The app will:
- Download medium-resolution images (~800px) for that album
- Run face detection on every image (batches of 5)
- Store bounding boxes and 128-dimensional face embeddings in the database

Progress is shown in real time.

#### 4. Label Faces (Face Trainer)
Click **Train** on a scanned album to open the **Face Trainer**:
- Navigate through photos that contain detected faces
- The face bounding box area shows where faces were found
- Assign a name to each face using the label form
- Aim for **3–5 labeled samples per person** for good accuracy; more is better

#### 5. Run Auto-Tagger
Go to the **Auto-Tagger** page and click **Run Auto-Tagger**. The engine:
- Builds a `FaceMatcher` from all stored training descriptors
- Runs recognition against every face-detected photo that hasn't been tagged yet
- Shows results with colour-coded confidence: 🟢 ≥70%, 🟡 50–70%, 🔴 <50%

Review the matches, use **✓ High Confidence** to auto-select reliable results, then click **Upload Tags**.

#### 6. Upload Tags to SmugMug (and Save Locally)
The app sends a `PATCH` request for each selected photo, writing formatted person keywords (`Person:Name` by default, or plain `Name` / custom prefix per Settings) while preserving all existing non-person tags. A 200ms delay is applied between requests to respect SmugMug's rate limits. Tag changes are also synced to a local portable `tags.json` manifest and can be exported to CSV or XMP sidecar files at any time.

---

## Data Storage

All local data is stored in Electron's `userData` directory:

| macOS | `~/Library/Application Support/smugmug_meta_tagger/smugmug-data/` |
|-------|----------------------------------------------------------------------|
| Windows | `%APPDATA%\smugmug_meta_tagger\smugmug-data\` |
| Linux | `~/.config/smugmug_meta_tagger/smugmug-data/` |

```
smugmug-data/
├── smugmug_tagger.db     # SQLite database (albums, images, face data, image_tags)
├── tags.json             # Auto-saved portable tag manifest (backup & re-import)
├── credentials.json      # Encrypted OAuth tokens
├── settings.json         # App preferences (threshold, keyword format, concurrency, etc.)
├── exports/              # On-demand tag exports
│   ├── smugmug_tags.csv  # Flat CSV export for spreadsheet auditing
│   └── xmp/              # XMP sidecars with dc:subject + MWG face regions
│       └── {albumKey}/
├── thumbnails/           # ~150px thumbnails, organised by albumKey
│   └── {albumKey}/
└── medium/               # ~800px images for face detection
    └── {albumKey}/
```

> **Storage estimate:** ~1–5 MB per 1,000 thumbnails; ~50–200 MB per 1,000 medium-res images.

---

## Settings

Open the **Settings** page to adjust:

| Setting | Default | Description |
|---------|---------|-------------|
| Recognition Threshold | `0.6` | Face match distance threshold (lower = stricter, range 0.4–0.8) |
| Concurrent Downloads | `5` | Parallel download connections |
| Keyword Format | `prefixed` | SmugMug keyword style: `prefixed` (`Person:Name`) or `plain` (`Name`) |
| Keyword Prefix | `Person:` | Prefix used when Keyword Format is `prefixed` (customizable, e.g. `Family:`) |
| Auto-save Tag Manifest | `true` | Automatically sync local `tags.json` when tags are saved, approved, or uploaded |
| Data Directory | (userData) | Where photos, the database, and local tag exports are stored |

### Danger Zone

- **Clear Training Data** — removes all face descriptors and people (albums/images preserved)
- **Reset Database** — drops and recreates all tables (full wipe)

---

## Project Structure

```
Smugmug_Meta_Tagger/
├── src/
│   ├── main/                        # Electron main process (Node.js)
│   │   ├── index.ts                 # App entry, window creation, service init
│   │   ├── preload.ts               # contextBridge IPC exposure
│   │   ├── ipc-handlers.ts          # IPC handler registration
│   │   └── services/
│   │       ├── oauth.ts             # OAuth 1.0a flow + safeStorage
│   │       ├── smugmug-api.ts       # SmugMug API v2 client (with retry)
│   │       ├── downloader.ts        # Tiered photo downloader (with retry)
│   │       ├── face-engine.ts       # face-api.js detection + recognition
│   │       └── database.ts          # SQLite schema + queries
│   ├── renderer/                    # React renderer process
│   │   ├── index.tsx                # React 19 root mount
│   │   ├── App.tsx                  # Sidebar layout + router + providers
│   │   ├── index.css                # Design system (dark theme)
│   │   ├── pages/
│   │   │   ├── LoginPage.tsx        # OAuth connect flow
│   │   │   ├── GalleryBrowser.tsx   # Album grid + download/scan
│   │   │   ├── FaceTrainer.tsx      # Per-photo face labeling
│   │   │   ├── AutoTagger.tsx       # Review matches + upload
│   │   │   └── SettingsPage.tsx     # Preferences + stats
│   │   └── components/
│   │       ├── Toast.tsx            # Toast notification system
│   │       ├── ErrorBoundary.tsx    # React error boundary
│   │       └── VirtualList.tsx      # Windowed list for large datasets
│   └── shared/
│       └── types.ts                 # Shared TypeScript interfaces + helpers
├── tests/                           # Spec-Driven Development (BDD)
│   ├── features/                    # Gherkin specification files (.feature)
│   └── step_defs/                   # Cucumber step definitions
├── models/                          # face-api.js model weights (~12 MB)
│   ├── ssd_mobilenetv1_model*
│   ├── face_landmark_68_model*
│   └── face_recognition_model*
├── forge.config.ts                  # Electron Forge build config
├── vite.main.config.ts
├── vite.preload.config.ts
├── vite.renderer.config.ts
├── tsconfig.json
└── package.json
```

---

## Keyword Format & Local Tag Exports

### SmugMug Keywords
Person tags written to SmugMug's `Keywords` field default to the `Person:` prefix, and can be configured in **Settings** to use plain names or a custom prefix:

```
# Prefixed (default)
Person:Jane Smith; Person:John Doe; vacation; hawaii

# Plain name
Jane Smith; John Doe; vacation; hawaii
```

- Existing non-person keywords are **always preserved**
- Old person tags for the same image are replaced (not duplicated)
- Tags are semicolon-delimited, matching SmugMug's format and working natively with SmugMug search and **Smart Galleries**

### Local Saved Files
Alongside `smugmug_tagger.db`, the app supports portable local tag files (see [plan.md](plan.md) for schemas and phased rollout):

- **`tags.json` (Auto-saved JSON Manifest)** — Human-readable backup of all tagged images, people, confidence scores, face bounding boxes, and approval/upload status. Can be re-imported after a database reset or machine migration.
- **`smugmug_tags.csv` (CSV Export)** — Flat spreadsheet export for bulk auditing and review in Excel or Google Sheets.
- **`.xmp` Sidecar Files (XMP Export)** — Industry-standard sidecars containing `dc:subject` keywords and **MWG Face Regions** (`mwg-rs:Regions`) preserving exact face bounding boxes for Lightroom, DigiKam, and Darktable.

---

## Testing (Spec-Driven Development)

This project uses Spec-Driven Development (SDD) to formalize requirements. Testing is powered by [Cucumber.js](https://github.com/cucumber/cucumber-js).

The tests are defined in human-readable Gherkin specifications (`.feature` files) and implemented using TypeScript step definitions.

### Running Tests

```bash
# Run the BDD test suite
npm run test:bdd
```

This will execute the Cucumber test runner and display the results of all scenarios.

---

## Troubleshooting

**App won't connect to SmugMug**
- Verify your API Key and Secret are correct
- Make sure you authorized the app with **Full Access + Modify** permissions
- Check that your SmugMug account has API access enabled

**Face detection finds no faces**
- Medium-res images must be downloaded first (click "Scan Faces", not just "Download")
- Ensure photos contain clearly visible faces (not too small, not at extreme angles)
- Very small face bounding boxes (<80px) may not be detected reliably

**Auto-tagger shows low confidence**
- Add more training samples per person (aim for 5–10 varied photos)
- Try lowering the recognition threshold in Settings (e.g. 0.5)
- Include samples with different lighting, angles, and expressions

**`npm start` fails with native module errors**
- Run `npm rebuild` to recompile native dependencies (`better-sqlite3`, `@napi-rs/canvas`) for your current Electron version
- Ensure your Node.js version matches the Electron-packaged Node version

---

## License

MIT — see [LICENSE](LICENSE) for details.
