import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.chrome = {
  tabs: {
    query: async () => [],
    get: async (id) => ({ id, url: 'https://notebooklm.google.com/' }),
    create: async ({ url, active }) => ({ id: 99, url, active }),
  },
};

const {
  ensureNotebookLmTab,
  isNotebookLmUrl,
  postNotebookLmCookies,
  validateNotebookLmSourceUrl,
} = await import(
  './modules/notebooklm_sync.mjs'
);

test('recognizes the current Gemini Notebook host as NotebookLM', () => {
  assert.equal(isNotebookLmUrl('https://notebook.google.com/'), true);
  assert.equal(isNotebookLmUrl('https://notebook.google.com/notebook/abc'), true);
  assert.equal(
    validateNotebookLmSourceUrl('https://notebook.google.com/').hostname,
    'notebook.google.com',
  );
});

test('reuses an authenticated Gemini Notebook tab across windows', async () => {
  const calls = [];
  chrome.tabs.query = async () => [
    { id: 11, url: 'https://notebook.google.com/' },
  ];
  chrome.tabs.get = async (id) => {
    calls.push(['get', id]);
    return { id, url: 'https://notebook.google.com/' };
  };
  chrome.tabs.create = async () => {
    calls.push(['create']);
    return { id: 99, url: 'https://notebooklm.google.com/' };
  };

  const tab = await ensureNotebookLmTab();
  assert.equal(tab.id, 11);
  assert.deepEqual(calls, [['get', 11]]);
});

test('reuses an authenticated NotebookLM tab across windows', async () => {
  const calls = [];
  chrome.tabs.query = async () => [
    { id: 12, url: 'https://notebooklm.google.com/notebook/abc' },
  ];
  chrome.tabs.get = async (id) => {
    calls.push(['get', id]);
    return { id, url: 'https://notebooklm.google.com/notebook/abc' };
  };
  chrome.tabs.create = async () => {
    calls.push(['create']);
    return { id: 99, url: 'https://notebooklm.google.com/' };
  };

  const tab = await ensureNotebookLmTab();
  assert.equal(tab.id, 12);
  assert.deepEqual(calls, [['get', 12]]);
});

test('reuses a pending Google sign-in tab instead of opening duplicates', async () => {
  const calls = [];
  chrome.tabs.query = async () => [
    { id: 13, url: 'https://accounts.google.com/v3/signin/identifier' },
  ];
  chrome.tabs.get = async (id) => {
    calls.push(['get', id]);
    return { id, url: 'https://accounts.google.com/v3/signin/identifier' };
  };
  chrome.tabs.create = async () => {
    calls.push(['create']);
    return { id: 99, url: 'https://notebooklm.google.com/' };
  };

  const tab = await ensureNotebookLmTab();
  assert.equal(tab.id, 13);
  assert.deepEqual(calls, [['get', 13]]);
});

test('opens NotebookLM only when no existing tab can be reused', async () => {
  const calls = [];
  chrome.tabs.query = async () => [];
  chrome.tabs.create = async ({ url, active }) => {
    calls.push(['create', url, active]);
    return { id: 14, url, active };
  };
  chrome.tabs.get = async (id) => {
    calls.push(['get', id]);
    return { id, url: 'https://notebooklm.google.com/' };
  };

  const tab = await ensureNotebookLmTab();
  assert.equal(tab.id, 14);
  assert.deepEqual(calls, [
    ['create', 'https://notebooklm.google.com/', true],
    ['get', 14],
    ['get', 14],
  ]);
});

test('forwards the one-time Profile 185 correlation ID to the VPS', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith('/sync/challenge')) {
      return new Response(JSON.stringify({ ok: true, challenge: 'challenge-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(
      JSON.stringify({
        ok: true,
        client_reloaded: true,
        auth_verified: true,
        received_count: 1,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  await postNotebookLmCookies({
    endpoint: 'https://notebooklm.1nutnhan.com/sync/cookies',
    token: 'test-token',
    cookies: [{ name: 'SID', value: 'secret' }],
    profileLoginId: '11111111-1111-4111-8111-111111111111',
  });

  const body = JSON.parse(requests[1].options.body);
  assert.equal(body.profile_login_id, '11111111-1111-4111-8111-111111111111');
});
