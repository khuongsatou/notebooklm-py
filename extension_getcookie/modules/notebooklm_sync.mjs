import getAllCookies from './get_all_cookies.mjs';

export const NOTEBOOKLM_ENTRY_URL = 'https://notebooklm.google.com/';
export const NOTEBOOKLM_SOURCE_URL = 'https://notebook.google.com/';
export const NOTEBOOKLM_HOST = 'notebooklm.google.com';
export const NOTEBOOKLM_APP_HOST = 'notebook.google.com';
const NOTEBOOKLM_HOSTS = new Set([NOTEBOOKLM_HOST, NOTEBOOKLM_APP_HOST]);
const NOTEBOOKLM_AUTH_HOST = 'accounts.google.com';
const NOTEBOOKLM_UNAVAILABLE_HOST = 'notebooklm.google';

function parseUrl(url, label) {
  try {
    return new URL(url);
  } catch {
    throw new Error(`${label} is not a valid URL.`);
  }
}

function normalizeProfileLoginId(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!normalized) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw new Error('Profile login correlation ID is invalid.');
  }
  return normalized;
}

export function isNotebookLmUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && NOTEBOOKLM_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function isNotebookLmAuthRedirect(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === NOTEBOOKLM_AUTH_HOST;
  } catch {
    return false;
  }
}

function isNotebookLmUnavailableRedirect(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === NOTEBOOKLM_UNAVAILABLE_HOST;
  } catch {
    return false;
  }
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTabUrl(tabId, timeoutMs = 8000) {
  const started = Date.now();
  let lastUrl = '';
  while (Date.now() - started < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    if (typeof tab.url === 'string' && tab.url && tab.url !== lastUrl) {
      lastUrl = tab.url;
      if (
        isNotebookLmUrl(tab.url) ||
        isNotebookLmAuthRedirect(tab.url) ||
        isNotebookLmUnavailableRedirect(tab.url)
      ) {
        return tab;
      }
    }
    await delay(250);
  }
  return chrome.tabs.get(tabId);
}

async function settleNotebookLmTab(tab) {
  if (tab?.id) {
    await delay(1200);
    return chrome.tabs.get(tab.id);
  }
  return tab;
}

export async function ensureNotebookLmTab() {
  // Search every window in this extension's Chrome profile. The bridge page
  // may be backgrounded while the user completes Google sign-in in another
  // window; the extension itself is still scoped to Profile 185.
  const tabs = await chrome.tabs.query({});
  const notebookTab = tabs.find((tab) => tab?.id && tab?.url && isNotebookLmUrl(tab.url));
  if (notebookTab) return settleNotebookLmTab(notebookTab);

  // A bridge page may poll while the user completes Google sign-in in another
  // tab. Reuse that tab instead of opening one new login tab on every poll.
  const pendingLoginTab = tabs.find(
    (tab) =>
      tab?.id &&
      tab?.url &&
      (isNotebookLmAuthRedirect(tab.url) || isNotebookLmUnavailableRedirect(tab.url)),
  );
  if (pendingLoginTab) return settleNotebookLmTab(pendingLoginTab);

  const tab = await chrome.tabs.create({
    url: NOTEBOOKLM_ENTRY_URL,
    active: true,
  });
  return settleNotebookLmTab(await waitForTabUrl(tab.id));
}

export function validateNotebookLmSourceUrl(sourceUrl) {
  const parsed = parseUrl(sourceUrl, 'NotebookLM source URL');
  if (parsed.protocol !== 'https:' || !NOTEBOOKLM_HOSTS.has(parsed.hostname)) {
    throw new Error('NotebookLM must stay on an official Google Notebook host before syncing cookies.');
  }
  if (!['', '/'].includes(parsed.pathname) || parsed.search || parsed.hash) {
    throw new Error('NotebookLM cookie source must be the root of an official Google Notebook host.');
  }
  return parsed;
}

export async function captureNotebookLmCookies(sourceUrl = NOTEBOOKLM_SOURCE_URL) {
  const parsed = validateNotebookLmSourceUrl(sourceUrl);
  const cookieUrl = new URL(parsed.href);
  const cookies = dedupeCookies(
    await getAllCookies({
      url: cookieUrl.href,
      partitionKey: { topLevelSite: cookieUrl.origin },
    }),
  );
  return {
    cookies,
    sourceUrl: parsed.href,
  };
}

function dedupeCookies(cookies) {
  const seen = new Set();
  const deduped = [];
  for (const cookie of cookies) {
    const key = [
      cookie.domain,
      cookie.path,
      cookie.name,
      cookie.value,
      cookie.expires ?? cookie.expirationDate ?? '',
      cookie.httpOnly ? 1 : 0,
      cookie.secure ? 1 : 0,
      cookie.sameSite ?? '',
    ].join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(cookie);
  }
  return deduped;
}

async function readJsonResponse(response, label) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(`${label} returned non-JSON content. Check the /sync/cookies endpoint.`);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
  if (!response.ok) {
    throw new Error(body?.error?.message || `${label} failed (${response.status}).`);
  }
  if (!body || typeof body !== 'object' || body.ok !== true) {
    throw new Error(`${label} returned an invalid success response.`);
  }
  return body;
}

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token.trim()}` } : {};
}

export async function postNotebookLmCookies({
  endpoint,
  token,
  cookies,
  sourceUrl = NOTEBOOKLM_SOURCE_URL,
  scope = 'notebooklm',
  profileLoginId = null,
}) {
  const parsedSourceUrl = validateNotebookLmSourceUrl(sourceUrl);
  const parsedEndpoint = parseUrl(endpoint, 'Cookie sync endpoint');
  const challengeUrl = new URL('/sync/challenge', parsedEndpoint.origin);
  const challengeResponse = await fetch(challengeUrl, {
    method: 'GET',
    headers: authHeaders(token),
    cache: 'no-store',
    credentials: 'omit',
  });
  const challengeResult = await readJsonResponse(challengeResponse, 'Cookie sync challenge');
  if (typeof challengeResult.challenge !== 'string' || !challengeResult.challenge) {
    throw new Error('Cookie server did not issue a valid sync challenge.');
  }
  const response = await fetch(parsedEndpoint.href, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(token),
    },
    body: JSON.stringify({
      scope,
      source_url: parsedSourceUrl.href,
      source: 'drive-down-cookies',
      captured_at: new Date().toISOString(),
      challenge: challengeResult.challenge,
      profile_login_id: normalizeProfileLoginId(profileLoginId),
      cookies,
    }),
  });
  const result = await readJsonResponse(response, 'Cookie sync');
  if (result.client_reloaded !== true || result.auth_verified !== true) {
    throw new Error('Cookie server did not verify the local Chrome session.');
  }
  if (result.received_count !== cookies.length) {
    throw new Error('Cookie server count does not match the local Chrome capture.');
  }
  return result;
}

export async function syncNotebookLmCookies({
  endpoint,
  token,
  sourceUrl = NOTEBOOKLM_SOURCE_URL,
  scope = 'notebooklm',
  profileLoginId = null,
} = {}) {
  const tab = await ensureNotebookLmTab();
  if (tab?.url) {
    if (isNotebookLmAuthRedirect(tab.url)) {
      throw new Error(
        'NotebookLM opened Google sign-in instead of the Google Notebook app. Re-authenticate in Chrome Profile 185 and try again.',
      );
    }
    if (isNotebookLmUnavailableRedirect(tab.url)) {
      throw new Error(
        'NotebookLM redirected to notebooklm.google/?location=unsupported. Open notebooklm.google.com in Chrome Profile 185 on a supported network first.',
      );
    }
    if (!isNotebookLmUrl(tab.url)) {
      throw new Error(
        'NotebookLM must be open on an official Google Notebook host before syncing cookies.',
      );
    }
  }
  const capture = await captureNotebookLmCookies(sourceUrl);
  const result = await postNotebookLmCookies({
    endpoint,
    token,
    cookies: capture.cookies,
    sourceUrl: capture.sourceUrl,
    scope,
    profileLoginId,
  });
  return {
    ...result,
    source_url: capture.sourceUrl,
    cookie_count: capture.cookies.length,
  };
}
