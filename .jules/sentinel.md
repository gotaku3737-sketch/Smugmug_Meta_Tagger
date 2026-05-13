## 2025-05-10 - [Block Arbitrary Navigation]
**Vulnerability:** The application was missing a `will-navigate` event handler, which could allow unauthorized navigation within the Electron app, exposing privileged APIs to external sites.
**Learning:** Adding navigation restrictions in Electron is essential to prevent unauthorized execution of external origins within the app.
**Prevention:** Always implement `will-navigate` event listeners to block arbitrary navigation, restricting it to trusted local dev servers or local `file://` protocols.

## 2026-05-13 - [Path Traversal via API Identifiers]
**Vulnerability:** Path traversal vulnerability in `src/main/services/downloader.ts` where `albumKey` (an identifier from SmugMug API) was directly interpolated into file paths (`path.join(..., albumKey)`) without sanitization.
**Learning:** Identifiers from external APIs should not be trusted as safe for file paths. Always explicitly sanitize all external inputs, including API keys and IDs, when using them to construct paths.
**Prevention:** Use an application-wide sanitization function (like `sanitizeFilename`) for all user or external API input that forms any part of a file path.
