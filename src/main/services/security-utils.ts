// ============================================================
// Pure Security Helpers (no Electron runtime dependency)
// ============================================================

/**
 * Validates that a hostname belongs to SmugMug (`smugmug.com`, `*.smugmug.com`,
 * or `*.smugmug.net`) to prevent SSRF on image downloads and HTTP redirects.
 */
export function isAllowedSmugMugHost(hostname: string): boolean {
  if (!hostname) return false;

  const normalized = hostname.trim().toLowerCase();
  if (
    !normalized ||
    normalized.includes(' ') ||
    normalized.includes('@') ||
    normalized.includes(':') ||
    normalized.startsWith('.') ||
    normalized.endsWith('.')
  ) {
    return false;
  }

  if (normalized === 'smugmug.com') {
    return true;
  }

  if (normalized.endsWith('.smugmug.com') || normalized.endsWith('.smugmug.net')) {
    const suffixIndex = normalized.lastIndexOf('.smugmug.');
    const prefix = normalized.slice(0, suffixIndex);
    return prefix.length > 0 && !prefix.endsWith('.');
  }

  return false;
}
