// ============================================================
// OAuth 1.0a Service for SmugMug API
// ============================================================

import crypto from 'node:crypto';
import https from 'node:https';
import { URL, URLSearchParams } from 'node:url';
import { safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import OAuth from 'oauth-1.0a';
import type { OAuthTokens, OAuthRequestToken, AuthStatus, SmugMugUser } from '../../shared/types';

const SMUGMUG_REQUEST_TOKEN_URL = 'https://api.smugmug.com/services/oauth/1.0a/getRequestToken';
const SMUGMUG_AUTHORIZE_URL = 'https://api.smugmug.com/services/oauth/1.0a/authorize';
const SMUGMUG_ACCESS_TOKEN_URL = 'https://api.smugmug.com/services/oauth/1.0a/getAccessToken';
const SMUGMUG_API_BASE = 'https://api.smugmug.com';

interface StoredCredentials {
  consumerKey: string;
  consumerSecret: string;  // encrypted
  accessToken?: string;
  accessTokenSecret?: string; // encrypted
}

export class OAuthService {
  private oauth: OAuth | null = null;
  private consumerKey = '';
  private consumerSecret = '';
  private accessToken = '';
  private accessTokenSecret = '';

  // Temporary state during auth flow
  private pendingRequestToken = '';
  private pendingRequestTokenSecret = '';

  private credentialsPath: string;

  constructor(dataDir: string) {
    this.credentialsPath = path.join(dataDir, 'credentials.json');
    this.loadStoredCredentials();
  }

  // -----------------------------------------------------------
  // Public API
  // -----------------------------------------------------------

  setCredentials(consumerKey: string, consumerSecret: string): void {
    this.consumerKey = consumerKey;
    this.consumerSecret = consumerSecret;
    this.initOAuth();
    this.saveCredentials();
  }

  async startAuth(): Promise<OAuthRequestToken> {
    if (!this.oauth) {
      throw new Error('Consumer credentials not set. Call setCredentials first.');
    }

    const requestData = {
      url: SMUGMUG_REQUEST_TOKEN_URL,
      method: 'GET' as const,
      data: { oauth_callback: 'oob' },
    };

    const headers = this.oauth.toHeader(
      this.oauth.authorize(requestData)
    ) as unknown as Record<string, string>;

    const response = await this.httpGet(
      `${SMUGMUG_REQUEST_TOKEN_URL}?oauth_callback=oob`,
      headers
    );

    const params = new URLSearchParams(response);
    const token = params.get('oauth_token');
    const tokenSecret = params.get('oauth_token_secret');

    if (!token || !tokenSecret) {
      throw new Error('Failed to obtain request token from SmugMug');
    }

    this.pendingRequestToken = token;
    this.pendingRequestTokenSecret = tokenSecret;

    const authorizationUrl = `${SMUGMUG_AUTHORIZE_URL}?oauth_token=${token}&Access=Full&Permissions=Modify`;

    return { token, tokenSecret, authorizationUrl };
  }

  async completeAuth(verifier: string): Promise<SmugMugUser> {
    if (!this.oauth || !this.pendingRequestToken) {
      throw new Error('No pending authorization. Call startAuth first.');
    }

    const requestData = {
      url: SMUGMUG_ACCESS_TOKEN_URL,
      method: 'GET' as const,
      data: { oauth_verifier: verifier },
    };

    const token = {
      key: this.pendingRequestToken,
      secret: this.pendingRequestTokenSecret,
    };

    const headers = this.oauth.toHeader(
      this.oauth.authorize(requestData, token)
    ) as unknown as Record<string, string>;

    const response = await this.httpGet(
      `${SMUGMUG_ACCESS_TOKEN_URL}?oauth_verifier=${encodeURIComponent(verifier)}`,
      headers
    );

    const params = new URLSearchParams(response);
    this.accessToken = params.get('oauth_token') || '';
    this.accessTokenSecret = params.get('oauth_token_secret') || '';

    if (!this.accessToken || !this.accessTokenSecret) {
      throw new Error('Failed to obtain access token from SmugMug');
    }

    // Clear pending state
    this.pendingRequestToken = '';
    this.pendingRequestTokenSecret = '';

    // Persist tokens
    this.saveCredentials();

    // Fetch and return user info
    return this.getAuthenticatedUser();
  }

  async getAuthStatus(): Promise<AuthStatus> {
    if (!this.consumerKey || !this.consumerSecret) {
      return { state: 'disconnected' };
    }

    if (!this.accessToken || !this.accessTokenSecret) {
      if (this.pendingRequestToken) {
        return {
          state: 'awaiting-verifier',
          authorizationUrl: `${SMUGMUG_AUTHORIZE_URL}?oauth_token=${this.pendingRequestToken}&Access=Full&Permissions=Modify`,
        };
      }
      return { state: 'disconnected' };
    }

    try {
      const user = await this.getAuthenticatedUser();
      return { state: 'connected', user };
    } catch {
      return { state: 'disconnected' };
    }
  }

  disconnect(): void {
    this.accessToken = '';
    this.accessTokenSecret = '';
    this.pendingRequestToken = '';
    this.pendingRequestTokenSecret = '';
    this.saveCredentials();
  }

  isAuthenticated(): boolean {
    return !!(this.accessToken && this.accessTokenSecret && this.oauth);
  }

  // -----------------------------------------------------------
  // Signed API Requests (used by SmugMugAPI service)
  // -----------------------------------------------------------

  async signedGet(url: string): Promise<unknown> {
    if (!this.oauth || !this.accessToken) {
      throw new Error('Not authenticated');
    }

    const requestData = { url, method: 'GET' as const };
    const token = { key: this.accessToken, secret: this.accessTokenSecret };
    const headers = {
      ...this.oauth.toHeader(this.oauth.authorize(requestData, token)),
      Accept: 'application/json',
    };

    const body = await this.httpGet(url, headers);
    return JSON.parse(body);
  }

  async signedPatch(url: string, data: Record<string, unknown>): Promise<unknown> {
    if (!this.oauth || !this.accessToken) {
      throw new Error('Not authenticated');
    }

    const requestData = { url, method: 'PATCH' as const };
    const token = { key: this.accessToken, secret: this.accessTokenSecret };
    const headers = {
      ...this.oauth.toHeader(this.oauth.authorize(requestData, token)),
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };

    const body = await this.httpRequest(url, 'PATCH', headers, JSON.stringify(data));
    return JSON.parse(body);
  }

  async downloadFile(url: string, destPath: string): Promise<void> {
    if (!this.oauth || !this.accessToken) {
      throw new Error('Not authenticated');
    }

    const requestData = { url, method: 'GET' as const };
    const token = { key: this.accessToken, secret: this.accessTokenSecret };
    const headers = this.oauth.toHeader(this.oauth.authorize(requestData, token));

    return new Promise((resolve, reject) => {
      const makeRequest = (requestUrl: string, redirectCount = 0) => {
        if (redirectCount > 5) {
          reject(new Error('Too many redirects'));
          return;
        }

        const parsedUrl = new URL(requestUrl);
        if (parsedUrl.protocol !== 'https:') {
          reject(new Error(`Invalid protocol for download: ${parsedUrl.protocol}. Only HTTPS is allowed.`));
          return;
        }

        const options = {
          hostname: parsedUrl.hostname,
          path: parsedUrl.pathname + parsedUrl.search,
          method: 'GET',
          headers: redirectCount === 0 ? headers : {}, // Only sign the first request
        };

        const req = https.request(options, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const redirectUrl = new URL(res.headers.location, requestUrl).href;
            makeRequest(redirectUrl, redirectCount + 1);
            return;
          }

          if (res.statusCode !== 200) {
            reject(new Error(`Download failed with status ${res.statusCode}`));
            return;
          }

          const dir = path.dirname(destPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          const fileStream = fs.createWriteStream(destPath);
          res.pipe(fileStream);
          fileStream.on('finish', () => {
            fileStream.close();
            resolve();
          });
          fileStream.on('error', reject);
        });

        req.on('error', reject);
        req.end();
      };

      makeRequest(url);
    });
  }

  // -----------------------------------------------------------
  // Private Helpers
  // -----------------------------------------------------------

  private initOAuth(): void {
    this.oauth = new OAuth({
      consumer: {
        key: this.consumerKey,
        secret: this.consumerSecret,
      },
      signature_method: 'HMAC-SHA1',
      hash_function(baseString: string, key: string) {
        return crypto
          .createHmac('sha1', key)
          .update(baseString)
          .digest('base64');
      },
    });
  }

  private async getAuthenticatedUser(): Promise<SmugMugUser> {
    const data = await this.signedGet(`${SMUGMUG_API_BASE}/api/v2!authuser`) as {
      Response: { User: { NickName: string; Name: string; ImageCount: number } };
    };

    const user = data.Response.User;
    return {
      nickname: user.NickName,
      displayName: user.Name || user.NickName,
    };
  }

  private httpGet(url: string, headers: Record<string, string>): Promise<string> {
    return this.httpRequest(url, 'GET', headers);
  }

  private httpRequest(
    url: string,
    method: string,
    headers: Record<string, string>,
    body?: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== 'https:') {
        reject(new Error(`Invalid protocol for request: ${parsedUrl.protocol}. Only HTTPS is allowed.`));
        return;
      }

      const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method,
        headers,
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', reject);

      if (body) {
        req.write(body);
      }
      req.end();
    });
  }

  // -----------------------------------------------------------
  // Credential Persistence (encrypted via safeStorage)
  // -----------------------------------------------------------

  private saveCredentials(): void {
    try {
      const dir = path.dirname(this.credentialsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const stored: StoredCredentials = {
        consumerKey: this.consumerKey,
        consumerSecret: this.encrypt(this.consumerSecret),
        accessToken: this.accessToken || undefined,
        accessTokenSecret: this.accessTokenSecret ? this.encrypt(this.accessTokenSecret) : undefined,
      };

      fs.writeFileSync(this.credentialsPath, JSON.stringify(stored, null, 2));
    } catch (err) {
      console.error('Failed to save credentials:', err);
    }
  }

  private loadStoredCredentials(): void {
    try {
      if (!fs.existsSync(this.credentialsPath)) return;

      const raw = fs.readFileSync(this.credentialsPath, 'utf-8');
      const stored: StoredCredentials = JSON.parse(raw);

      this.consumerKey = stored.consumerKey;
      this.consumerSecret = this.decrypt(stored.consumerSecret);
      this.initOAuth();

      if (stored.accessToken && stored.accessTokenSecret) {
        this.accessToken = stored.accessToken;
        this.accessTokenSecret = this.decrypt(stored.accessTokenSecret);
      }
    } catch (err) {
      console.error('Failed to load credentials:', err);
    }
  }

  private encrypt(text: string): string {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(text).toString('base64');
    }
    // Fallback: store as-is (less secure, but works in dev)
    return `plain:${text}`;
  }

  private decrypt(encoded: string): string {
    if (encoded.startsWith('plain:')) {
      return encoded.slice(6);
    }
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
    }
    return encoded;
  }
}
