# Security & Privacy Policy

SmugMug Meta Tagger is a personal, single-user desktop application designed to run face detection and recognition **100% locally** on your machine using your own SmugMug API application credentials.

---

## Privacy & Local-Only Processing

- **No cloud AI or telemetry:** All face detection, landmark extraction, and 128-dimensional embedding generation runs locally via `@vladmandic/face-api` (`models/` bundled in the repo). Photos, face embeddings, and person names are never sent to any third-party AI service or external server.
- **Minimal resolution downloads:** The app downloads small thumbnails (~150px) for browsing and medium-resolution images (~800px) for face detection. Full-resolution originals are never downloaded.

---

## SmugMug API Access & Scope

- **Authentication:** Uses OAuth 1.0a (out-of-band verifier code) with your own SmugMug Developer API Key and Secret.
- **Why `Access=Full&Permissions=Modify` is requested:** The app reads your albums and images (including private/unlisted galleries you own) and writes updated semicolon-delimited `Keywords` back to SmugMug via `PATCH /api/v2/image/{imageKey}`.
- **Token storage:** Your SmugMug Consumer Key, Consumer Secret, OAuth Access Token, and Access Token Secret are encrypted at rest using Electron's `safeStorage` API (backed by macOS Keychain, Windows DPAPI, or Linux libsecret) and stored in `credentials.json` with `0o600` permissions.

> [!WARNING]
> **Public vs. Private Galleries:** Writing person names to SmugMug `Keywords` on **Public** or **Unlisted** galleries makes those names visible and searchable to anyone who can view those galleries. Exercise caution when tagging family members or minors in public albums.

---

## Local Data & Biometrics at Rest

All local application data is stored inside Electron's `userData` directory (`smugmug-data/`):

| Artifact | Contents | Protection at Rest |
|----------|----------|--------------------|
| `credentials.json` | SmugMug API key/secret and OAuth tokens | Encrypted via OS keychain (`safeStorage`), `0o600` permissions |
| `smugmug_tagger.db` | Album/image metadata, 128-dim face embeddings (`face_descriptors`), `people`, `image_tags` | Plaintext SQLite with `0o600` file / `0o700` dir permissions |
| `tags.json` & `exports/` | Portable JSON tag manifest, CSV exports, XMP sidecars | Plaintext files with `0o600` permissions |
| `thumbnails/` & `medium/` | Cached ~150px and ~800px JPEGs | Plaintext files with `0o600` file / `0o700` dir permissions |

Because biometric face embeddings, person names, and cached photos are stored as standard local files, **enabling OS full-disk encryption** (macOS FileVault, Windows BitLocker, or Linux LUKS) is strongly recommended.

---

## Electron Security Posture

- **Renderer isolation:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and `webviews` disabled (`will-attach-webview` prevented).
- **Electron Fuses:** Packaged builds enable `EnableCookieEncryption`, `EnableEmbeddedAsarIntegrityValidation`, and `OnlyLoadAppFromAsar`, while disabling `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`, and `EnableNodeCliInspectArguments`.
- **Permission & Navigation Controls:** All web permission requests/checks (`geolocation`, `media`, etc.) are denied; in-app navigation to external origins is blocked; external links open via `shell.openExternal` only for `http:`, `https:`, and `mailto:` protocols.
- **Content Security Policy & Input Hardening:** Enforces CSP headers via `session.defaultSession.webRequest.onHeadersReceived`, sanitizes filesystem path segments against traversal, enforces `https:` downloads, validates `api.smugmug.com` hostnames on API URI expansion, and wraps IPC handlers to avoid leaking stack traces.

See [plan.md](plan.md) (**Roadmap v2**) for planned security and privacy enhancements (removing the `plain:` credential fallback, local font bundling, SmugMug download redirect allowlisting, album privacy guardrails, and CSV formula-injection protection).

---

## Reporting a Vulnerability

If you discover a security vulnerability or privacy issue, please **do not** open a public GitHub issue. Instead, report it privately via **GitHub Security Advisories** ("Report a vulnerability" in the repository's **Security** tab) with steps to reproduce and the affected component.
