const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  chromeProfileDirectory,
  inspectChromeProfile,
  openProfileLogin,
  profileLoginUrl,
} = require("./profile185.cjs");

function makeChromeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "notebooklm-profile185-"));
  const chromePath = path.join(root, "Google Chrome");
  const userDataDirectory = path.join(root, "User Data");
  const profilePath = path.join(userDataDirectory, "Profile 185");
  fs.writeFileSync(chromePath, "fixture");
  fs.mkdirSync(profilePath, { recursive: true });
  fs.writeFileSync(
    path.join(userDataDirectory, "Local State"),
    JSON.stringify({
      profile: {
        info_cache: {
          "Profile 185": { name: "NotebookLM", user_name: "owner@example.com" },
        },
      },
    }),
  );
  fs.writeFileSync(
    path.join(profilePath, "Secure Preferences"),
    JSON.stringify({
      extensions: {
        settings: {
          cclelndahbckbenkjhflpdbgdldlbecc: {
            location: 4,
            path: "/fixture/extension_getcookie",
            has_started_service_worker: true,
            service_worker_registration_info: { version: "0.7.6" },
          },
        },
      },
    }),
  );
  return {
    root,
    env: {
      NOTEBOOKLM_CHROME_PATH: chromePath,
      NOTEBOOKLM_CHROME_USER_DATA_DIR: userDataDirectory,
      NOTEBOOKLM_CHROME_PROFILE_DIRECTORY: "Profile 185",
    },
  };
}

test("profile directory rejects paths and accepts Profile 185", () => {
  assert.equal(
    chromeProfileDirectory({ NOTEBOOKLM_CHROME_PROFILE_DIRECTORY: "Profile 185" }),
    "Profile 185",
  );
  assert.throws(
    () => chromeProfileDirectory({ NOTEBOOKLM_CHROME_PROFILE_DIRECTORY: "../Profile 185" }),
    /one Chrome profile directory name/,
  );
});

test("profile login URL is HTTPS and carries the bridge marker", () => {
  assert.equal(
    profileLoginUrl(
      { NOTEBOOKLM_PROFILE_LOGIN_URL: "https://example.test/login" },
      "11111111-1111-4111-8111-111111111111",
    ),
    "https://example.test/login?notebooklm_profile_login=1&profile_login_id=11111111-1111-4111-8111-111111111111",
  );
  assert.throws(
    () => profileLoginUrl({ NOTEBOOKLM_PROFILE_LOGIN_URL: "http://example.test" }),
    /must use HTTPS/,
  );
});

test("profile inspection validates Chrome and Profile 185 metadata", (t) => {
  const fixture = makeChromeFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const result = inspectChromeProfile({ env: fixture.env, platform: "darwin" });
  assert.equal(result.ok, true);
  assert.equal(result.profile_directory, "Profile 185");
  assert.equal(result.profile_name, "NotebookLM");
  assert.equal(result.profile_email, "owner@example.com");
  assert.equal(result.extension_configured, true);
  assert.equal(result.extension_version, "0.7.6");
});

test("openProfileLogin launches Chrome with Profile 185 and bridge URL", async (t) => {
  const fixture = makeChromeFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const calls = [];
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.unref = () => undefined;
    queueMicrotask(() => child.emit("spawn"));
    return child;
  };
  const result = await openProfileLogin({
    env: fixture.env,
    platform: "darwin",
    spawnImpl,
    loginId: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, "opened");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, fixture.env.NOTEBOOKLM_CHROME_PATH);
  assert.deepEqual(calls[0].args, [
    "--profile-directory=Profile 185",
    "https://notebooklm.1nutnhan.com/profile-login?notebooklm_profile_login=1&profile_login_id=11111111-1111-4111-8111-111111111111",
  ]);
  assert.deepEqual(calls[0].options, { detached: true, stdio: "ignore" });
});

test("openProfileLogin fails before spawn when Profile 185 is absent", async (t) => {
  const fixture = makeChromeFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  fs.rmSync(path.join(fixture.env.NOTEBOOKLM_CHROME_USER_DATA_DIR, "Profile 185"), {
    recursive: true,
    force: true,
  });
  const result = await openProfileLogin({ env: fixture.env, platform: "darwin" });
  assert.equal(result.ok, false);
  assert.equal(result.status, "profile_missing");
});

test("openProfileLogin fails before spawn when the required extension is absent", async (t) => {
  const fixture = makeChromeFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(fixture.env.NOTEBOOKLM_CHROME_USER_DATA_DIR, "Profile 185", "Secure Preferences"),
    JSON.stringify({ extensions: { settings: {} } }),
  );
  const result = await openProfileLogin({ env: fixture.env, platform: "darwin" });
  assert.equal(result.ok, false);
  assert.equal(result.status, "extension_missing");
});
