import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NOTEBOOKLM_ENTRY_URL,
  NOTEBOOKLM_SOURCE_URL,
  isNotebookLmUrl,
  validateNotebookLmSourceUrl,
} from '../../../extension_getcookie/modules/notebooklm_sync.mjs';

test('NotebookLM helper accepts only the canonical NotebookLM host', () => {
  assert.equal(NOTEBOOKLM_ENTRY_URL, 'https://notebooklm.google.com/');
  assert.equal(NOTEBOOKLM_SOURCE_URL, 'https://notebooklm.google.com/');
  assert.equal(isNotebookLmUrl(NOTEBOOKLM_ENTRY_URL), true);
  assert.equal(isNotebookLmUrl(NOTEBOOKLM_SOURCE_URL), true);
  assert.equal(isNotebookLmUrl('https://notebooklm.google.com/notebook/abc'), true);
  assert.equal(isNotebookLmUrl('https://notebook.google.com/'), false);
  assert.equal(isNotebookLmUrl('https://accounts.google.com/signin'), false);
  assert.equal(isNotebookLmUrl('http://notebooklm.google.com/'), false);
});

test('source URL validation rejects redirected or spoofed hosts', () => {
  assert.equal(validateNotebookLmSourceUrl(NOTEBOOKLM_SOURCE_URL).href, NOTEBOOKLM_SOURCE_URL);
  assert.throws(
    () => validateNotebookLmSourceUrl('https://notebook.google.com/'),
    /notebooklm\.google\.com/,
  );
  assert.throws(
    () => validateNotebookLmSourceUrl('https://notebooklm.google.com.evil.example/'),
    /notebooklm\.google\.com/,
  );
  assert.throws(
    () => validateNotebookLmSourceUrl('https://accounts.google.com/signin'),
    /notebooklm\.google\.com/,
  );
  assert.throws(
    () => validateNotebookLmSourceUrl('https://notebooklm.google.com/notebook/abc'),
    /source must be https:\/\/notebooklm\.google\.com\/\./,
  );
  assert.throws(
    () => validateNotebookLmSourceUrl('https://notebooklm.google.com/?authuser=0'),
    /source must be https:\/\/notebooklm\.google\.com\/\./,
  );
});
