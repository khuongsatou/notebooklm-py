import { formatMap, jsonToNetscapeMapper } from './modules/cookie_format.mjs';
import getAllCookies from './modules/get_all_cookies.mjs';
import {
  captureNotebookLmCookies,
  ensureNotebookLmTab,
  postNotebookLmCookies,
} from './modules/notebooklm_sync.mjs';
import _saveToFile from './modules/save_to_file.mjs';

/** Promise to get URL of Active Tab */
const getUrlPromise = chrome.tabs
  .query({ active: true, currentWindow: true })
  .then(([{ url }]) => new URL(url));

const syncModeSelect = {
  local: document.querySelector('#modeLocal'),
  server: document.querySelector('#modeServer'),
  automatic: document.querySelector('#modeAutomatic'),
};

const syncToggle = document.querySelector('#syncToggle');
const syncStatus = document.querySelector('#syncStatus');
const verifyOauthLink = document.querySelector('#verifyOauthLink');
const serverEndpointInput = document.querySelector('#serverEndpoint');
const serverTokenInput = document.querySelector('#serverToken');
const sendNowButton = document.querySelector('#sendNow');
const clearSyncDataButton = document.querySelector('#clearSyncData');

const STORAGE_KEYS = {
  mode: 'cookieRouteMode',
  enabled: 'cookieRouteEnabled',
  endpoint: 'cookieRouteEndpoint',
  token: 'cookieRouteToken',
  checkpoint: 'cookieRouteCheckpointV1',
};

const DEFAULT_ENDPOINT = 'https://notebooklm.1nutnhan.com/sync/cookies';
const NOTEBOOKLM_VERIFY_URL = 'https://notebooklm.google.com/';

function normalizeCookieEndpoint(_value) {
  // Fail closed to the project's one trusted VPS receiver. A stale value in
  // extension storage must never redirect local Google cookies elsewhere.
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

const state = {
  mode: localStorage.getItem(STORAGE_KEYS.mode) || 'local',
  enabled: localStorage.getItem(STORAGE_KEYS.enabled) === 'true',
  endpoint: localStorage.getItem(STORAGE_KEYS.endpoint) || DEFAULT_ENDPOINT,
  token: localStorage.getItem(STORAGE_KEYS.token) || '',
};

try {
  state.endpoint = normalizeCookieEndpoint(state.endpoint);
} catch {
  state.endpoint = DEFAULT_ENDPOINT;
}

function checkpointSnapshot() {
  return {
    version: 1,
    mode: state.mode,
    enabled: state.enabled,
    endpoint: normalizeCookieEndpoint(state.endpoint),
    token: state.token.trim(),
  };
}

async function persistState() {
  const checkpoint = checkpointSnapshot();
  Object.assign(state, checkpoint);
  localStorage.setItem(STORAGE_KEYS.mode, state.mode);
  localStorage.setItem(STORAGE_KEYS.enabled, String(state.enabled));
  localStorage.setItem(STORAGE_KEYS.endpoint, state.endpoint);
  localStorage.setItem(STORAGE_KEYS.token, state.token);
  await chrome.storage.local.set({
    [STORAGE_KEYS.mode]: state.mode,
    [STORAGE_KEYS.enabled]: state.enabled,
    [STORAGE_KEYS.endpoint]: state.endpoint,
    [STORAGE_KEYS.token]: state.token,
    [STORAGE_KEYS.checkpoint]: checkpoint,
  });
}

async function clearPersistedSyncState() {
  state.mode = 'local';
  state.enabled = false;
  state.endpoint = DEFAULT_ENDPOINT;
  state.token = '';
  for (const key of Object.values(STORAGE_KEYS)) {
    localStorage.removeItem(key);
  }
  await chrome.storage.local.remove(Object.values(STORAGE_KEYS));
  serverEndpointInput.value = state.endpoint;
  serverTokenInput.value = state.token;
  renderSyncControls();
}

function validMode(value) {
  return ['local', 'server', 'automatic'].includes(value) ? value : null;
}

async function loadCheckpoint() {
  const stored = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
  const checkpoint = stored[STORAGE_KEYS.checkpoint];
  const checkpointState =
    checkpoint && typeof checkpoint === 'object' && checkpoint.version === 1
      ? checkpoint
      : {};

  state.mode =
    validMode(checkpointState.mode) || validMode(stored[STORAGE_KEYS.mode]) || state.mode;
  state.enabled =
    typeof checkpointState.enabled === 'boolean'
      ? checkpointState.enabled
      : typeof stored[STORAGE_KEYS.enabled] === 'boolean'
        ? stored[STORAGE_KEYS.enabled]
        : state.enabled;
  state.endpoint = normalizeCookieEndpoint(
    checkpointState.endpoint || stored[STORAGE_KEYS.endpoint] || state.endpoint,
  );
  state.token = String(
    checkpointState.token || stored[STORAGE_KEYS.token] || state.token || '',
  ).trim();

  serverEndpointInput.value = state.endpoint;
  serverTokenInput.value = state.token;
  await persistState();
}

function reportCheckpointFailure(error) {
  setSyncStatus(
    error instanceof Error ? `Could not save settings: ${error.message}` : 'Could not save settings.',
    'error',
  );
}

function clearVerifyLink() {
  verifyOauthLink.hidden = true;
  verifyOauthLink.removeAttribute('href');
}

function setVerifyLink(url = NOTEBOOKLM_VERIFY_URL) {
  verifyOauthLink.href = url;
  verifyOauthLink.hidden = false;
}

function setSyncStatus(message, kind = 'neutral', { verifyUrl = null } = {}) {
  syncStatus.textContent = message;
  syncStatus.dataset.kind = kind;
  if (verifyUrl) {
    setVerifyLink(verifyUrl);
  } else {
    clearVerifyLink();
  }
}

function renderSyncControls() {
  for (const [mode, button] of Object.entries(syncModeSelect)) {
    const active = state.mode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-checked', String(active));
  }

  syncToggle.classList.toggle('on', state.enabled);
  syncToggle.classList.toggle('off', !state.enabled);
  syncToggle.textContent = state.enabled ? 'ON' : 'OFF';
  syncToggle.setAttribute('aria-pressed', String(state.enabled));

  if (!state.enabled) {
    setSyncStatus('Sync is off.', 'muted');
    return;
  }
  if (!state.endpoint.trim()) {
    setSyncStatus('Set a server endpoint first.', 'warning');
    return;
  }
  if (state.mode === 'local') {
    setSyncStatus('Local mode ready.', 'success');
  } else if (state.mode === 'server') {
    setSyncStatus('Server sync armed.', 'success');
  } else {
    setSyncStatus('Automatic mode ready.', 'success');
  }
}

function setMode(mode) {
  state.mode = mode;
  persistState().catch(reportCheckpointFailure);
  renderSyncControls();
}

function setEnabled(enabled) {
  state.enabled = enabled;
  persistState().catch(reportCheckpointFailure);
  renderSyncControls();
}

function syncModeAllowsServer() {
  return state.enabled && (state.mode === 'server' || state.mode === 'automatic');
}

function isNotebookLmAuthFailure(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  const normalized = message.toLowerCase();
  return (
    normalized.includes('failed live notebooklm authentication') ||
    normalized.includes('authentication expired or invalid') ||
    normalized.includes('run \'notebooklm login\' to re-authenticate')
  );
}

async function getCookieSnapshot(details) {
  const cookies = await getAllCookies(details);
  const format = formatMap[document.querySelector('#format').value];
  if (!format) throw new Error('Invalid format');
  const text = format.serializer(cookies);
  return { cookies, text, format };
}

// ----------------------------------------------
// Functions
// ----------------------------------------------

/**
 * Get Stringified Cookies Text and Format Data
 * @param {chrome.cookies.GetAllDetails} details
 * @returns {Promise<{ text: string, format: Format, cookies: chrome.cookies.Cookie[] }>}
 */
const getCookieText = async (details) => {
  return getCookieSnapshot(details);
};

// TODO: use offscreen API to integrate implementation in chrome and firefox
/**
 * Save text data as a file
 * Firefox cannot use saveAs in a popup, so the background script handles it.
 * @param {string} text
 * @param {string} name
 * @param {Format} format
 * @param {boolean} saveAs
 */
const saveToFile = async (text, name, { ext, mimeType }, saveAs = false) => {
  const format = { ext, mimeType };
  const isFirefox =
    chrome.runtime.getManifest().browser_specific_settings !== undefined;
  if (isFirefox) {
    await chrome.runtime.sendMessage({
      type: 'save',
      target: 'background',
      data: { text, name, format, saveAs },
    });
  } else {
    await _saveToFile(text, name, format, saveAs);
  }
};

/**
 * Copy text data to the clipboard
 * @param {string} text
 */
const setClipboard = async (text) => {
  await navigator.clipboard.writeText(text);
  const copyButton = document.getElementById('copy');
  copyButton.classList.add('copied');
  setTimeout(() => {
    copyButton.classList.remove('copied');
  }, 2000);
};

function cookiePayload(cookies, scope, sourceUrl) {
  return {
    scope,
    source_url: sourceUrl,
    source: 'drive-down-cookies',
    captured_at: new Date().toISOString(),
    cookies,
  };
}

async function checkServerConnection() {
  if (!state.endpoint.trim()) {
    renderSyncControls();
    return false;
  }
  try {
    const statusUrl = new URL('/sync/status', new URL(state.endpoint).origin);
    const headers = {};
    if (state.token.trim()) {
      headers.Authorization = `Bearer ${state.token.trim()}`;
    }
    const response = await fetch(statusUrl, {
      method: 'GET',
      headers,
      cache: 'no-store',
      credentials: 'omit',
    });
    await readJsonResponse(response, 'Cookie server status');
    setSyncStatus(`Connected to ${statusUrl.origin}.`, 'success');
    return true;
  } catch {
    setSyncStatus('Not connected. Check endpoint and token.', 'error');
    return false;
  }
}

async function clearServerCookieState() {
  const endpoint = normalizeCookieEndpoint(state.endpoint);
  const clearUrl = new URL('/sync/cookies', new URL(endpoint).origin);
  const headers = {};
  if (state.token.trim()) {
    headers.Authorization = `Bearer ${state.token.trim()}`;
  }
  const response = await fetch(clearUrl, {
    method: 'DELETE',
    headers,
    cache: 'no-store',
    credentials: 'omit',
  });
  return readJsonResponse(response, 'Cookie clear');
}

async function postCookiesToServer(cookies, scope, sourceUrl, { force = false } = {}) {
  if (!force && !syncModeAllowsServer()) {
    return { skipped: true };
  }
  const endpoint = normalizeCookieEndpoint(state.endpoint);
  if (!endpoint) {
    throw new Error('Server endpoint is empty.');
  }
  const headers = { 'Content-Type': 'application/json' };
  if (state.token.trim()) {
    headers.Authorization = `Bearer ${state.token.trim()}`;
  }
  const challengeUrl = new URL('/sync/challenge', new URL(endpoint).origin);
  const challengeResponse = await fetch(challengeUrl, {
    method: 'GET',
    headers: state.token.trim() ? { Authorization: `Bearer ${state.token.trim()}` } : {},
    cache: 'no-store',
    credentials: 'omit',
  });
  const challengeResult = await readJsonResponse(challengeResponse, 'Cookie sync challenge');
  if (typeof challengeResult.challenge !== 'string' || !challengeResult.challenge) {
    throw new Error('Cookie server did not issue a valid sync challenge.');
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...cookiePayload(cookies, scope, sourceUrl),
      challenge: challengeResult.challenge,
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

async function exportCookies(details, { saveAs = false, scope = 'current' } = {}) {
  const { text, format, cookies } = await getCookieSnapshot(details);
  const url = details.url ? new URL(details.url) : null;
  const name = url ? `${url.hostname}_cookies` : 'cookies';
  if (state.mode !== 'server') {
    await saveToFile(text, name, format, saveAs);
  }
  if (state.mode === 'server' || state.mode === 'automatic') {
    if (!syncModeAllowsServer()) {
      if (state.mode === 'server') {
        throw new Error('Turn sync ON before using server mode.');
      }
      return { saved: true, synced: false };
    }
    const serverResult = await postCookiesToServer(cookies, scope, url?.href || null);
    const serverStatus = serverResult?.restart_required
      ? `${serverResult?.status || 'ok'}; restart required`
      : serverResult?.status;
    setSyncStatus(
      serverStatus ? `Server: ${serverStatus}` : 'Server sync done.',
      'success',
    );
  }
  if (state.mode === 'local' || state.mode === 'automatic') {
    return { saved: true };
  }
  return { saved: false };
}

async function runPopupAction(action) {
  try {
    await action();
  } catch (error) {
    if (isNotebookLmAuthFailure(error)) {
      setSyncStatus('NotebookLM OAuth needs verification.', 'warning', {
        verifyUrl: NOTEBOOKLM_VERIFY_URL,
      });
      return;
    }
    setSyncStatus(error instanceof Error ? error.message : 'Action failed.', 'error');
  }
}

// ----------------------------------------------
// Actions after resolving the promise
// ----------------------------------------------

/** Set URL in the header */
getUrlPromise.then((url) => {
  const location = document.querySelector('#location');
  location.textContent = location.href = url.href;
});

/** Set Cookies data to the table */
getUrlPromise
  .then((url) =>
    getAllCookies({
      url: url.href,
      partitionKey: { topLevelSite: url.origin },
    }),
  )
  .then((cookies) => {
    const netscape = jsonToNetscapeMapper(cookies);
    const tableRows = netscape.map((row) => {
      const tr = document.createElement('tr');
      tr.replaceChildren(
        ...row.map((v) => {
          const td = document.createElement('td');
          td.textContent = v;
          return td;
        }),
      );
      return tr;
    });
    document.querySelector('table tbody').replaceChildren(...tableRows);
  });

// ----------------------------------------------
// Event Listeners
// ----------------------------------------------

document.querySelector('#export').addEventListener('click', async () => {
  await runPopupAction(async () => {
    const url = await getUrlPromise;
    const details = { url: url.href, partitionKey: { topLevelSite: url.origin } };
    await exportCookies(details, { saveAs: false, scope: 'current' });
  });
});

document.querySelector('#exportAs').addEventListener('click', async () => {
  await runPopupAction(async () => {
    const url = await getUrlPromise;
    const details = { url: url.href, partitionKey: { topLevelSite: url.origin } };
    await exportCookies(details, { saveAs: true, scope: 'current' });
  });
});

document.querySelector('#copy').addEventListener('click', async () => {
  await runPopupAction(async () => {
    const url = await getUrlPromise;
    const details = { url: url.href, partitionKey: { topLevelSite: url.origin } };
    const { text, cookies } = await getCookieText(details);
    await setClipboard(text);
    if (syncModeAllowsServer()) {
      await postCookiesToServer(cookies, 'current', url.href);
      setSyncStatus('Copied and synced.', 'success');
    }
  });
});

document.querySelector('#exportAll').addEventListener('click', async () => {
  await runPopupAction(async () => {
    await exportCookies({ partitionKey: {} }, { saveAs: false, scope: 'all' });
  });
});

sendNowButton.addEventListener('click', async () => {
  await runPopupAction(async () => {
    sendNowButton.disabled = true;
    try {
      setSyncStatus('Opening notebooklm.google.com in Profile 185...', 'neutral');
      await ensureNotebookLmTab();
      setSyncStatus('Capturing NotebookLM cookies...', 'neutral');
      const { cookies, sourceUrl } = await captureNotebookLmCookies();
      setSyncStatus('Sending NotebookLM cookies...', 'neutral');
      const result = await postNotebookLmCookies({
        endpoint: state.endpoint,
        token: state.token.trim(),
        cookies,
        sourceUrl,
        scope: 'notebooklm',
      });
      setSyncStatus(
        `Sent ${result.cookie_count ?? cookies.length} cookies successfully.`,
        'success',
      );
    } finally {
      sendNowButton.disabled = false;
    }
  });
});

verifyOauthLink.addEventListener('click', async (event) => {
  event.preventDefault();
  await chrome.tabs.create({ url: NOTEBOOKLM_VERIFY_URL, active: true });
});

clearSyncDataButton.addEventListener('click', async () => {
  await runPopupAction(async () => {
    const shouldClear = window.confirm(
      'Clear old sync data for this extension and delete the server auth storage? '
        + 'This will not remove your Google login cookies from Chrome.',
    );
    if (!shouldClear) return;
    clearSyncDataButton.disabled = true;
    sendNowButton.disabled = true;
    const hadToken = Boolean(state.token.trim());
    try {
      setSyncStatus('Clearing server cookie storage...', 'neutral');
      if (hadToken) {
        await clearServerCookieState();
      }
      setSyncStatus('Clearing local extension checkpoint...', 'neutral');
      await clearPersistedSyncState();
      setSyncStatus(
        hadToken
          ? 'Cleared old server cookies and local checkpoint.'
          : 'Cleared local checkpoint. Add token to clear server storage too.',
        hadToken ? 'success' : 'warning',
      );
    } finally {
      clearSyncDataButton.disabled = false;
      sendNowButton.disabled = false;
    }
  });
});

/** Set last used format value */
const formatSelect = document.querySelector('#format');

const selectedFormat = localStorage.getItem('selectedFormat');
if (selectedFormat) {
  formatSelect.value = selectedFormat;
}

formatSelect.addEventListener('change', () => {
  localStorage.setItem('selectedFormat', formatSelect.value);
});

for (const [mode, button] of Object.entries(syncModeSelect)) {
  button.addEventListener('click', () => setMode(mode));
}

syncToggle.addEventListener('click', async () => {
  setEnabled(!state.enabled);
  if (state.enabled) {
    await checkServerConnection();
  }
});

serverEndpointInput.addEventListener('change', async () => {
  state.endpoint = serverEndpointInput.value.trim();
  await persistState();
  renderSyncControls();
  await checkServerConnection();
});

serverTokenInput.addEventListener('input', () => {
  state.token = serverTokenInput.value;
  // Save every edit immediately so closing the popup cannot lose the token.
  persistState().catch(reportCheckpointFailure);
});

loadCheckpoint()
  .then(async () => {
    renderSyncControls();
    if (state.enabled) await checkServerConnection();
  })
  .catch(reportCheckpointFailure);
