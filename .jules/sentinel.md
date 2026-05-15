## 2025-05-10 - [Block Arbitrary Navigation]
**Vulnerability:** The application was missing a `will-navigate` event handler, which could allow unauthorized navigation within the Electron app, exposing privileged APIs to external sites.
**Learning:** Adding navigation restrictions in Electron is essential to prevent unauthorized execution of external origins within the app.
**Prevention:** Always implement `will-navigate` event listeners to block arbitrary navigation, restricting it to trusted local dev servers or local `file://` protocols.

## 2026-05-13 - [Path Traversal via API Identifiers]
**Vulnerability:** Path traversal vulnerability in `src/main/services/downloader.ts` where `albumKey` (an identifier from SmugMug API) was directly interpolated into file paths (`path.join(..., albumKey)`) without sanitization.
**Learning:** Identifiers from external APIs should not be trusted as safe for file paths. Always explicitly sanitize all external inputs, including API keys and IDs, when using them to construct paths.
**Prevention:** Use an application-wide sanitization function (like `sanitizeFilename`) for all user or external API input that forms any part of a file path.

## 2025-05-18 - [Path Traversal bypass in sanitizeFilename]
**Vulnerability:** A path traversal vulnerability existed in the `sanitizeFilename` function, where exact strings `.` and `..` were not replaced because they did not contain characters stripped by the regex. When appended to a directory via `path.join`, this allowed moving up directories despite sanitization attempts.
**Learning:** Even explicit sanitization functions can miss critical path traversal edge-cases if they only strip slashes and illegal file characters. Exact parent-directory (`..`) matches must be explicitly handled.
**Prevention:** Ensure all sanitization routines mitigate exactly `.` and `..` references by escaping them (e.g. prefixing them with an underscore).

## 2026-05-18 - [SSRF and Open Redirects via OAuth Client]
**Vulnerability:** The `downloadFile` and `httpRequest` methods in the OAuth service lacked strict URL protocol validation. They could be tricked into requesting arbitrary URIs or local file paths (SSRF). Additionally, redirects were loosely handled, potentially crashing on relative URL strings.
**Learning:** When making requests (especially following redirects), always explicitly validate the target protocol against a strict whitelist (e.g. `https:`) and safely resolve redirect URLs against the base URL.
**Prevention:** In `https.request` or any networking code, throw an error if the protocol is not `https:`. Ensure `res.headers.location` is parsed using `new URL(location, baseUrl).href`.
