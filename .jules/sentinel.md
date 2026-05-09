## 2024-05-09 - [Fix arbitrary code execution risk in openExternal]
**Vulnerability:** The `shell.openExternal(url)` function in Electron was used without validating the protocol of the URL.
**Learning:** If an attacker can control the URL (e.g. via XSS), they could use protocols like `file://` or `javascript://` to execute arbitrary code or open local files.
**Prevention:** Always parse untrusted URLs using `new URL(url)` and validate that the `protocol` is in an allowlist of expected safe protocols (like `http:`, `https:`, `mailto:`) before calling `shell.openExternal`. Use a try-catch to handle invalid URLs gracefully.
