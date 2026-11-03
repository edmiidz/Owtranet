import fs from 'fs';
import os from 'os';
import path from 'path';

// Read lazily so entrypoints can set INTRANET_BASE_URL before the first request.
export const BASE_URL = process.env.INTRANET_BASE_URL || 'https://intranet.example.com';
function baseUrl() {
  return process.env.INTRANET_BASE_URL || BASE_URL;
}
export const TOKEN_PATH = path.join(os.homedir(), '.config', 'owtranet', 'webmail-token');

export function loadToken() {
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(
      `No webmail token found at ${TOKEN_PATH}. Run "npm run login" in mcp-webmail/ to sign in and save one.`
    );
  }
  const token = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
  if (!token) {
    throw new Error(`Webmail token file at ${TOKEN_PATH} is empty. Run "npm run login" again.`);
  }
  return token;
}

export function saveToken(token) {
  const dir = path.dirname(TOKEN_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TOKEN_PATH, token, { mode: 0o600 });
  try {
    fs.chmodSync(TOKEN_PATH, 0o600);
  } catch {
    // chmod is a no-op on Windows filesystems; ignore.
  }
}

export async function webmailRequest(pathSuffix, { method = 'GET', query, body, token } = {}) {
  // Explicit token (hosted http.js mints one per request) beats the saved login token.
  if (!token) token = loadToken();
  const url = new URL(pathSuffix, baseUrl());
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, value);
      }
    }
  }

  const headers = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `Webmail auth failed (HTTP ${res.status}). The saved token is likely expired or invalid — run "npm run login" in mcp-webmail/ again.`
    );
  }

  let data = {};
  try {
    data = await res.json();
  } catch {
    // Non-JSON response body; fall through to status check below.
  }

  if (!res.ok) {
    throw new Error(data.error || data.details || `Webmail request failed: HTTP ${res.status}`);
  }

  return data;
}
