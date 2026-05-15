## 2025-05-10 - [Block Arbitrary Navigation]
**Vulnerability:** The application was missing a `will-navigate` event handler, which could allow unauthorized navigation within the Electron app, exposing privileged APIs to external sites.
**Learning:** Adding navigation restrictions in Electron is essential to prevent unauthorized execution of external origins within the app.
**Prevention:** Always implement `will-navigate` event listeners to block arbitrary navigation, restricting it to trusted local dev servers or local `file://` protocols.

## 2024-05-11 - Encrypt API Keys at Rest
**Vulnerability:** SmugMug API `consumerKey` and `accessToken` were stored in plaintext on the local filesystem.
**Learning:** Only the `secret` portions were encrypted. A malicious local application could read the `credentials.json` file and extract API keys.
**Prevention:** All sensitive API credentials should be encrypted at rest. When fixing legacy systems, a try/catch fallback can maintain backwards compatibility for old, unencrypted data.
