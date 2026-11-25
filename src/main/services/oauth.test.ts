import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedSmugMugHost } from './security-utils';

describe('isAllowedSmugMugHost', () => {
  test('allows valid SmugMug domains and subdomains (case-insensitive)', () => {
    const validHosts = [
      'api.smugmug.com',
      'photos.smugmug.com',
      'smugmug.com',
      'cdn.smugmug.net',
      'API.SMUGMUG.COM',
      'Photos.SmugMug.Com',
      'SMUGMUG.COM',
      'CDN.SMUGMUG.NET',
      'a.b.smugmug.com',
      'img-1.smugmug.net',
    ];

    for (const host of validHosts) {
      assert.equal(isAllowedSmugMugHost(host), true, `Expected ${host} to be allowed`);
    }
  });

  test('rejects lookalikes, non-SmugMug domains, IPs, and empty strings', () => {
    const rejectedHosts = [
      'evilsmugmug.com',
      'smugmug.com.evil.com',
      'sub.smugmug.com.evil.com',
      'smugmug.net',
      '.smugmug.com',
      '.smugmug.net',
      'localhost',
      '127.0.0.1',
      '169.254.169.254',
      '::1',
      '[::1]',
      '',
      '   ',
      'user@api.smugmug.com',
      'api.smugmug.com:443',
      'api.smugmug.com.',
    ];

    for (const host of rejectedHosts) {
      assert.equal(isAllowedSmugMugHost(host), false, `Expected ${host} to be rejected`);
    }
  });
});
