import getAllCookies from './modules/get_all_cookies.mjs';
import { syncNotebookLmCookies } from './modules/notebooklm_sync.mjs';
import saveToFile from './modules/save_to_file.mjs';

const DEFAULT_ENDPOINT = 'https://notebooklm.1nutnhan.com/sync/cookies';
const STORAGE_KEYS = {
  endpoint: 'cookieRouteEndpoint',
  token: 'cookieRouteToken',
  checkpoint: 'cookieRouteCheckpointV1',
};

// Keep the bearer-token checkpoint available only to extension-owned pages and
// the service worker, even if a content script is added later.
chrome.storage.local
  .setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' })
  .catch(() => undefined);

function normalizeCookieEndpoint(_value) {
  // This project is single-tenant: local Google cookies may only be uploaded
  // to its pinned VPS receiver, never to a stale/custom stored origin.
  return DEFAULT_ENDPOINT;
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

async function getRouteSettings() {
  const stored = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
  const checkpoint = stored[STORAGE_KEYS.checkpoint];
  const checkpointState =
    checkpoint && typeof checkpoint === 'object' && checkpoint.version === 1
      ? checkpoint
      : {};
  const endpoint = normalizeCookieEndpoint(
    checkpointState.endpoint || stored[STORAGE_KEYS.endpoint],
  );
  const token = String(
    checkpointState.token || stored[STORAGE_KEYS.token] || '',
  ).trim();
  if (
    stored[STORAGE_KEYS.endpoint] !== endpoint ||
    stored[STORAGE_KEYS.token] !== token ||
    checkpointState.endpoint !== endpoint ||
    checkpointState.token !== token
  ) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.endpoint]: endpoint,
      [STORAGE_KEYS.token]: token,
      [STORAGE_KEYS.checkpoint]: {
        ...checkpointState,
        version: 1,
        endpoint,
        token,
      },
    });
  }
  return {
    endpoint,
    token,
  };
}

function authHeaders(token) {
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function checkSyncConnection() {
  const { endpoint, token } = await getRouteSettings();
  const statusUrl = new URL('/sync/status', new URL(endpoint).origin);
  const response = await fetch(statusUrl, {
    method: 'GET',
    headers: authHeaders(token),
    cache: 'no-store',
    credentials: 'omit',
  });
  const result = await readJsonResponse(response, 'Cookie server status');
  return {
    ok: true,
    extension_version: chrome.runtime.getManifest().version,
    server: statusUrl.origin,
    ...result,
  };
}

async function syncNotebookLMCookies() {
  const { endpoint, token } = await getRouteSettings();
  return syncNotebookLmCookies({ endpoint, token });
}

async function clearServerCookieState() {
  const { endpoint, token } = await getRouteSettings();
  const clearUrl = new URL('/sync/cookies', new URL(endpoint).origin);
  const response = await fetch(clearUrl, {
    method: 'DELETE',
    headers: authHeaders(token),
    cache: 'no-store',
    credentials: 'omit',
  });
  const result = await readJsonResponse(response, 'Cookie clear');
  return {
    ok: true,
    ...result,
  };
}

function externalResponse(task, sendResponse) {
  task()
    .then((result) => sendResponse(result))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Extension request failed.',
      });
    });
  return true;
}

chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'drive-down-cookies') return false;
  if (message.type === 'connect') {
    return externalResponse(checkSyncConnection, sendResponse);
  }
  if (message.type === 'sync-now') {
    return externalResponse(syncNotebookLMCookies, sendResponse);
  }
  if (message.type === 'clear-sync-data') {
    return externalResponse(clearServerCookieState, sendResponse);
  }
  sendResponse({ ok: false, error: 'Unsupported extension request.' });
  return false;
});

/**
 * Update icon badge counter on active page
 */
const updateBadgeCounter = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    return;
  }
  const { id: tabId, url: urlString } = tab;
  if (!urlString) {
    chrome.action.setBadgeText({ tabId, text: '' });
    return;
  }
  const url = new URL(urlString);
  const cookies = await getAllCookies({
    url: url.href,
    partitionKey: { topLevelSite: url.origin },
  });
  const text = cookies.length.toFixed();
  chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
  chrome.action.setBadgeText({ tabId, text });
  chrome.action.setTitle({ tabId, title: `Drive Down Cookies - ${text} cookies` });
};

chrome.cookies.onChanged.addListener(updateBadgeCounter);
chrome.tabs.onUpdated.addListener(updateBadgeCounter);
chrome.tabs.onActivated.addListener(updateBadgeCounter);
chrome.windows.onFocusChanged.addListener(updateBadgeCounter);

// Update notification
chrome.runtime.onInstalled.addListener(({ previousVersion, reason }) => {
  if (reason === 'update') {
    const currentVersion = chrome.runtime.getManifest().version;
    chrome.notifications.create('updated', {
      type: 'basic',
      title: 'Drive Down Cookies',
      message: `Updated from ${previousVersion} to ${currentVersion}`,
      iconUrl: '/images/icon128.png',
      buttons: [{ title: 'Github Releases' }, { title: 'Uninstall' }],
    });
  }
});

// Update notification's button handler
chrome.notifications.onButtonClicked.addListener(
  (notificationId, buttonIndex) => {
    console.log(notificationId, buttonIndex);
    if (notificationId === 'updated') {
      switch (buttonIndex) {
        case 0:
          chrome.tabs.create({
            url: 'https://github.com/kairi003/Get-cookies.txt-LOCALLY/releases',
          });
          break;
        case 1:
          chrome.management.uninstallSelf({ showConfirmDialog: true });
          break;
      }
    }
  },
);

// TODO: use offscreen API to integrate implementation in chrome and firefox
// Save file message listener for firefox
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  const { type, target, data } = message || {};
  if (target !== 'background') return;
  if (type === 'save') {
    const { text, name, format, saveAs } = data || {};
    await saveToFile(text, name, format, saveAs);
    sendResponse('done');
    return true;
  }
  return true;
});
