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

## 2024-11-26 - [Settings File Permissions]
**Vulnerability:** The application was missing explicit file permissions restrictions (`mode: 0o600`) when writing settings file.
**Learning:** Even for non-credentials file, it is a good practice to explicitly define file permission limits, such as `mode: 0o600`, acting as an additional layer of defense.
**Prevention:** Always enforce strict file-system permissions (`mode: 0o600`) utilizing `fs.writeFileSync` options or `fs.chmodSync` when creating and handling any sensitive files.

## 2026-05-22 - [Resource Exhaustion via Missing Timeouts]
**Vulnerability:** External API requests using Node's `https` module (in `oauth.ts`) did not specify a `timeout` option and did not handle the `timeout` event. This could lead to request hanging indefinitely if the external server is unresponsive, causing resource exhaustion.
**Learning:** Always specify a `timeout` option for external network requests and handle the `timeout` event properly (e.g., by calling `req.destroy()`) to prevent resource exhaustion and hanging requests.
**Prevention:** Include a `timeout` option in `https.request` configuration and listen for the `timeout` event to proactively terminate the request.
## 2024-05-18 - [IPC Audit Logging]
**Vulnerability:** Missing logging on sensitive application state transitions
**Learning:** Adding IPC handler wrapping allows to transparently log invocations of sensitive endpoints
**Prevention:** Implement audit trails on the system boundary (IPC layer)

## 2025-05-24 - [Missing Global Security Headers]
**Vulnerability:** The application was missing global security headers (like Content-Security-Policy, X-Frame-Options, X-Content-Type-Options) applied via Electron's `webRequest.onHeadersReceived`, leaving webviews potentially exposed to framing, MIME-sniffing, and XSS if an attacker controls loaded content.
**Learning:** While HTML-level `<meta>` CSP tags provide some protection, intercepting headers directly in Electron's network stack ensures strict defense-in-depth policies apply universally to all requested resources and windows.
**Prevention:** Always implement `session.defaultSession.webRequest.onHeadersReceived` to globally inject strict security headers (e.g., CSP, `nosniff`, `DENY`) for all Electron browser windows.

## 2026-05-25 - [SSRF and URL Injection via API Client]
**Vulnerability:** In `src/main/services/smugmug-api.ts`, dynamic path parameters like `nickname`, `albumKey`, and `imageKey` were interpolated directly into API URL strings without URL encoding.
**Learning:** Failing to URL encode dynamic path parameters allows an attacker (or external system) to inject special characters (like `?`, `&`, `#`, or `/`) into the path, potentially altering the intended API endpoint structure leading to SSRF or data exfiltration.
**Prevention:** Always use `encodeURIComponent` when interpolating variables into URL paths or queries.

## 2026-05-26 - [Directory Permissions for WAL SQLite and Sensitive Files]
**Vulnerability:** The application was missing explicit file permission limits (`mode: 0o700`) for directories containing sensitive files like the OAuth credentials and the SQLite database. SQLite databases using WAL mode dynamically create and destroy `-wal` and `-shm` files, bypassing the permissions set on the main `.db` file, which requires the parent directory to restrict access.
**Learning:** File permissions on dynamically recreated files (like WAL files) are easily lost unless the parent directory is also secured. Securing directories is as critical as securing the files themselves.
**Prevention:** Always enforce directory permissions (`mode: 0o700`) using `fs.mkdirSync` options and `fs.chmodSync` when creating directories that will house sensitive database or credential files.

## 2026-05-27 - [Missing explicit directory permissions for downloads]
**Vulnerability:** The `ensureDir` function in `src/main/services/downloader.ts` and the inline directory creation in `src/main/services/oauth.ts` created directories for storing downloaded user assets using `fs.mkdirSync` without specifying restrictive permissions (e.g., `mode: 0o700`). This could allow other local OS users to view or modify downloaded assets, particularly if the parent directory (like the OS's temp or app data folder) was misconfigured.
**Learning:** Defense-in-depth requires that all application-managed directories on the file system, particularly those holding user data or assets, be explicitly restricted to the user running the application to minimize the impact of file system access misconfigurations or vulnerabilities in other software.
**Prevention:** Always provide the `mode: 0o700` option (read/write/execute for the owner only) when invoking `fs.mkdirSync` to create application directories, and retroactively enforce it using `fs.chmodSync` for existing directories where possible.

## 2026-05-28 - [SSRF and URL Injection via Relative Path Resolution]
**Vulnerability:** In `src/main/services/smugmug-api.ts`, dynamic path parameters provided by the SmugMug API (like `img.Uris?.ImageSizeDetails?.Uri`) were concatenated directly with the `API_BASE` URL. If an attacker managed to manipulate the API response to include a path starting with `//attacker.com` or `@attacker.com`, the resulting URL string (e.g. `https://api.smugmug.com@attacker.com`) could be misinterpreted by the Node HTTP client, leading to Server-Side Request Forgery (SSRF) and leakage of OAuth credentials.
**Learning:** Directly concatenating paths with a base URL is inherently risky if the path comes from an untrusted or external source. The `URL` constructor handles `//` and `@` in paths gracefully, but checking the resulting `.hostname` ensures the destination domain is strictly as intended.
**Prevention:** Always use the `URL` constructor (`new URL(path, baseUrl)`) to resolve relative paths and validate the `.hostname` property against expected domains before making outbound requests.
