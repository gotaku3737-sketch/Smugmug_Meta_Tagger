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

## 2025-05-19 - [Missing Content Security Policy and Unrestricted Webviews]
**Vulnerability:** The application was missing a strict Content Security Policy (CSP) and allowed unauthorized webviews, which could expose the app to XSS and arbitrary external content rendering.
**Learning:** In Electron, strict CSP and blocking unneeded renderer capabilities (like `webview`) are critical layers of defense-in-depth.
**Prevention:** Always inject a strict CSP tag and use `app.on('web-contents-created')` to block `will-attach-webview` to prevent abuse.

## 2025-05-20 - [Unrestricted Web Permissions]
**Vulnerability:** The application was missing an explicit permission request handler, which means the application might allow web content to silently access privileged APIs like geolocation, camera, or microphone if the Electron version defaults to permissive.
**Learning:** Adding a strict default permission request handler in Electron is essential to adhere to the principle of least privilege.
**Prevention:** Always implement `session.defaultSession.setPermissionRequestHandler` to deny unexpected permission requests by default.
## 2025-05-21 - [Sensitive Credentials File Permissions]
**Vulnerability:** The application was missing explicit file permissions restrictions (`mode: 0o600`) when writing sensitive OAuth API keys and tokens to disk.
**Learning:** Even when using `safeStorage` to encrypt secrets, an attacker or other user on the same system may still be able to copy or extract the file content. Further, if the environment fallback triggers and stores plaintext secrets, overly permissive file-system controls allow direct compromise.
**Prevention:** Always enforce strict file-system permissions (`mode: 0o600`) utilizing `fs.writeFileSync` options or `fs.chmodSync` when creating and handling sensitive credential files.

## 2024-05-20 - [Information Leakage via IPC Errors]
**Vulnerability:** IPC handlers in the main process (`faces:detectInAlbum` and `tags:runAutoTagger`) were re-throwing original error objects across the IPC bridge to the renderer process. This could potentially leak sensitive internal application state or stack traces to the frontend environment.
**Learning:** Raw errors thrown across an IPC bridge can bypass security boundaries by exposing internal error messages or stack traces that attackers might use to understand the system's inner workings.
**Prevention:** Ensure that errors thrown over the IPC bridge from the main process to the renderer are caught and replaced with generic, secure error messages. Raw errors should be logged in the main process (`console.error`) but masked before crossing the trust boundary.
## 2024-05-18 - [Secure IPC Error Handling]
**Vulnerability:** IPC handlers potentially leaking stack traces and sensitive server-side details to the renderer process when errors occur.
**Learning:** In Electron, errors thrown in `ipcMain.handle` are directly passed back to the renderer (`ipcRenderer.invoke`). This can expose backend implementation details, file paths, and database query structures.
**Prevention:** Always wrap IPC handlers in a generic error boundary that logs the detailed error on the backend (Main Process) but only returns a safe, sanitized message (e.g., 'An internal error occurred') to the frontend.
