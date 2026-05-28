/**
 * FlowVideoPlayer Resolver
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements the two-step API contract captured in the network screenshots:
 *
 *  Step 1 — POST /api/generateTokenNew
 *    → Returns { app_secret_key, token, ... }
 *
 *  Step 2 — POST /api/v2/getVideoNew   (with those credentials in headers)
 *    Body: { "url": "https://1024terabox.com/s/..." }
 *    → Returns { response: [{ stream_url, fast_stream_url, download_url, ... }] }
 *
 * Tokens are cached in memory and refreshed automatically when they expire
 * or when the server returns an auth error.
 */

'use strict';

const https  = require('https');
const http   = require('http');
const zlib   = require('zlib');
const logger = require('./logger');

// ── Config (matches the app exactly as seen in the screenshots) ───────────────
const DEVICE_ID = 'cb783ce6-3945-42d8-bd4d-c333dea1a2c3';

const APP_INFO = {
  appName:        'Flow Video Player',
  buildNumber:    '49',
  packageName:    'com.flowplayer.flowplayer',
  version:        '3.0.1+1',
  buildSignature: 'F46F6D30D6D6F903C1F405EACABF8289012FBF0AF0B19D6E2E28A7B116374934',
  installerStore: 'com.android.vending',
  installTime:    '2026-05-26T17:13:30.029',
  updateTime:     '2026-05-26T17:13:30.029',
};

const DEVICE_INFO = {
  device:           'TB-8504X',
  isPhysicalDevice: true,
  freeDiskSize:     2407071744,
  bootloader:       'unknown',
  id:               'NMF26F',
  version: {
    securityPatch: '2017-10-01',
    sdkInt:        25,
    incremental:   'TB-8504X_S140001_171208_IPB',
    release:       '7.1.1',
    baseOS:        '',
    previewSdkInt: 0,
    codename:      'REL',
  },
  manufacturer:      'LENOVO',
  tags:              'release-keys',
  type:              'user',
  availableRamSize:  827,
  host:              'shws64',
  supported32BitAbis: ['armeabi-v7a', 'armeabi'],
  isLowRamDevice:    false,
  fingerprint:       'Lenovo/TB-8504X/TB-8504X:7.1.1/NMF26F/TB-8504X_USR_S001_171208_Q12000_IPB:user/release-keys',
  board:             'QC_Reference_Phone',
  supportedAbis:     ['arm64-v8a', 'armeabi-v7a', 'armeabi'],
  display:           'TB-8504X_S140001_171208_IPB',
  brand:             'Lenovo',
  supported64BitAbis: ['arm64-v8a'],
  totalDiskSize:     9630986240,
  name:              'Lenovo TB-8504X',
  physicalRamSize:   1878,
  hardware:          'qcom',
  product:           'TB-8504X',
  model:             'Lenovo TB-8504X',
};

// ── In-memory token cache ─────────────────────────────────────────────────────
let cachedToken = null;
// { app_secret_key, token, fetchedAt }
// Tokens are refreshed if older than TOKEN_TTL_MS or on 401/403 response

const TOKEN_TTL_MS = 55 * 60 * 1000; // 55 minutes (conservative)

// ── Low-level HTTPS helper ────────────────────────────────────────────────────
/**
 * Make an HTTPS POST to flowvideoplayer.com, handle gzip, return parsed JSON.
 */
function flowRequest(path, bodyObj, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(bodyObj);
    const buf     = Buffer.from(bodyStr, 'utf8');

    const baseHeaders = {
      'user-agent':       'Dart/3.10 (dart:io)',
      'accept':           'application/json',
      'accept-encoding':  'gzip',
      'content-type':     'application/json',
      'content-length':   buf.length,
      'device-id':        DEVICE_ID,
      'timestamp':        Date.now().toString(),
      'is-uid':           'no',
    };

    const options = {
      hostname: 'flowvideoplayer.com',
      port:     443,
      path,
      method:   'POST',
      headers:  { ...baseHeaders, ...extraHeaders },
      timeout:  30000,
    };

    const req = https.request(options, (res) => {
      const enc    = res.headers['content-encoding'];
      let stream   = res;

      if (enc === 'gzip')    stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());

      let raw = '';
      stream.on('data',  c  => (raw += c));
      stream.on('error', err => reject(new Error(`Stream error: ${err.message}`)));
      stream.on('end',   ()  => {
        logger.info(`[flowvideoplayer] ${path} → HTTP ${res.statusCode}`);
        if (res.statusCode >= 400) {
          return reject(new Error(
            `flowvideoplayer HTTP ${res.statusCode}: ${raw.slice(0, 200)}`
          ));
        }
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error(`Non-JSON response from ${path}: ${raw.slice(0, 300)}`));
        }
      });
    });

    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error(`Request to ${path} timed out`));
    });

    req.on('error', err => reject(new Error(`Network error: ${err.message}`)));
    req.write(buf);
    req.end();
  });
}

// ── Step 1: Generate / refresh token ─────────────────────────────────────────
async function fetchToken() {
  logger.info('[flowvideoplayer] Fetching new token…');

  const data = await flowRequest('/api/generateTokenNew', {
    app_info:    APP_INFO,
    device_info: DEVICE_INFO,
    device_id:   DEVICE_ID,
  });

  // Response shape may vary — extract the credentials defensively
  const appSecretKey =
    data?.app_secret_key  ||
    data?.data?.app_secret_key ||
    data?.result?.app_secret_key;

  const token =
    data?.token ||
    data?.data?.token ||
    data?.result?.token;

  if (!appSecretKey || !token) {
    throw new Error(
      `generateTokenNew: missing credentials. Response: ${JSON.stringify(data).slice(0, 300)}`
    );
  }

  cachedToken = { appSecretKey, token, fetchedAt: Date.now() };
  logger.info(`[flowvideoplayer] Token obtained (key: ${appSecretKey.slice(0, 12)}…)`);
  return cachedToken;
}

function isTokenFresh() {
  return (
    cachedToken &&
    Date.now() - cachedToken.fetchedAt < TOKEN_TTL_MS
  );
}

async function getToken() {
  if (isTokenFresh()) return cachedToken;
  return fetchToken();
}

// ── Step 2: Resolve video URL ─────────────────────────────────────────────────
/**
 * Given a 1024terabox / terabox share URL, return the best streamable URL.
 * Priority: fast_stream_url > stream_url > download_url
 */
async function resolveWithFlowPlayer(teraboxUrl, retryOnAuthError = true) {
  const { appSecretKey, token } = await getToken();

  logger.info(`[flowvideoplayer] Resolving: ${teraboxUrl}`);

  let data;
  try {
    data = await flowRequest(
      '/api/v2/getVideoNew',
      { url: teraboxUrl },
      {
        'app-secret-key': appSecretKey,
        'authorization':  '',           // sent blank, as seen in screenshot
        'app-token':      '',           // sent blank, as seen in screenshot
        'token':          token,
      }
    );
  } catch (err) {
    // On auth errors, invalidate cache and retry once
    if (retryOnAuthError && /40[13]/.test(err.message)) {
      logger.warn('[flowvideoplayer] Auth error — refreshing token and retrying…');
      cachedToken = null;
      return resolveWithFlowPlayer(teraboxUrl, false);
    }
    throw err;
  }

  // Validate response shape (matches Image 3)
  if (!data?.status || data?.code !== 200) {
    throw new Error(
      `getVideoNew failed: code=${data?.code} message=${data?.message} error=${data?.error}`
    );
  }

  const items = data?.response;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(`getVideoNew: empty response array. Full: ${JSON.stringify(data).slice(0, 300)}`);
  }

  const item = items[0];

  // Return the best available URL (priority order)
  const videoUrl =
    (item.fast_stream_url && item.fast_stream_url.length > 10 ? item.fast_stream_url : null) ||
    (item.stream_url      && item.stream_url.length      > 10 ? item.stream_url      : null) ||
    (item.download_url    && item.download_url.length    > 10 ? item.download_url    : null);

  if (!videoUrl) {
    throw new Error(
      `getVideoNew: no usable URL in response item. Keys: ${JSON.stringify(Object.keys(item))}`
    );
  }

  logger.info(`[flowvideoplayer] ✓ Resolved (${item.file_size || '?'}): ${videoUrl.slice(0, 80)}…`);

  return {
    videoUrl,
    streamUrl:      item.stream_url      || null,
    fastStreamUrl:  item.fast_stream_url || null,
    downloadUrl:    item.download_url    || null,
    thumbnail:      item.thumbnail       || null,
    fileName:       item.file_name       || null,
    fileSize:       item.file_size       || null,
    fileSizeBytes:  item.file_size_bytes || null,
  };
}

// ── Force token refresh (callable from routes for debugging) ──────────────────
function invalidateToken() {
  cachedToken = null;
  logger.info('[flowvideoplayer] Token cache cleared');
}

function getTokenStatus() {
  if (!cachedToken) return { cached: false };
  const ageMs = Date.now() - cachedToken.fetchedAt;
  return {
    cached:      true,
    ageSeconds:  Math.floor(ageMs / 1000),
    fresh:       ageMs < TOKEN_TTL_MS,
    expiresInMs: Math.max(0, TOKEN_TTL_MS - ageMs),
  };
}

module.exports = {
  resolveWithFlowPlayer,
  fetchToken,
  invalidateToken,
  getTokenStatus,
};
