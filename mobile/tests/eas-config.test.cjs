/**
 * EAS cloud build and OTA update configuration regressions.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const mobileRoot = path.join(__dirname, '..');
const repoRoot = path.join(mobileRoot, '..');
const appJson = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'app.json'), 'utf8')).expo;
const easJson = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'eas.json'), 'utf8'));
const pkgJson = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'package.json'), 'utf8'));
const settingsSource = fs.readFileSync(path.join(mobileRoot, 'app/settings.tsx'), 'utf8');

test('eas.json configures remote auto-incrementing versions, channels, and API URLs', () => {
  assert.equal(easJson.cli?.appVersionSource, 'remote');
  for (const profileName of ['development', 'preview', 'production']) {
    const profile = easJson.build?.[profileName];
    assert.ok(profile, `missing ${profileName} build profile`);
    assert.equal(profile.channel, profileName, `${profileName} channel must match profile`);
    assert.equal(
      profile.env?.EXPO_PUBLIC_API_URL,
      'https://api-finindv.nikahbos.web.id',
      `${profileName} must target production API`
    );
  }
  assert.equal(easJson.build.preview.autoIncrement, true);
  assert.equal(easJson.build.production.autoIncrement, true);
  assert.equal(easJson.build.preview.android?.buildType, 'apk');
  assert.equal(easJson.build.production.android?.buildType, 'app-bundle');
});

test('app.json avoids remote versionCode conflicts and enables fingerprint-based OTA updates', () => {
  assert.equal(appJson.android?.versionCode, undefined);
  assert.equal(appJson.userInterfaceStyle, 'automatic');
  assert.equal(appJson.runtimeVersion?.policy, 'fingerprint');
  const projectId = appJson.extra?.eas?.projectId;
  assert.ok(projectId, 'EAS projectId must be configured');
  assert.equal(appJson.updates?.url, `https://u.expo.dev/${projectId}`);
  assert.ok(pkgJson.dependencies['expo-updates'], 'expo-updates must be installed');
  assert.equal(appJson.version, pkgJson.version);
  assert.match(settingsSource, new RegExp(`label="Versi"\\s+value="${appJson.version.replace(/\./g, '\\.')}"`));
  assert.ok(fs.existsSync(path.join(repoRoot, '.github/workflows/release-apk.yml')));
});
