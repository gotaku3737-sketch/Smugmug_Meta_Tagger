## 2025-05-10 - [Block Arbitrary Navigation]
**Vulnerability:** The application was missing a `will-navigate` event handler, which could allow unauthorized navigation within the Electron app, exposing privileged APIs to external sites.
**Learning:** Adding navigation restrictions in Electron is essential to prevent unauthorized execution of external origins within the app.
**Prevention:** Always implement `will-navigate` event listeners to block arbitrary navigation, restricting it to trusted local dev servers or local `file://` protocols.

## 2025-05-12 - [Fix Path Traversal in Download Directories]
**Vulnerability:** The `albumKey` input passed from IPC to `path.join()` in `downloader.ts` was unsanitized, allowing potential path traversal (e.g., `../../../../etc/passwd`).
**Learning:** Even internal or non-filename identifiers (like keys or IDs) used in filesystem path construction can be vectors for directory traversal if they originate from IPC messages.
**Prevention:** Always sanitize any user or IPC-provided input used in filesystem paths, for example, by applying a sanitizer like `sanitizeFilename`.
