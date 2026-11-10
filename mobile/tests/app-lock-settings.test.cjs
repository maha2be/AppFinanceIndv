/**
 * Wizard tests for the staged pattern-lock settings flow.
 *
 * The screen is mounted with the shared mini renderer. PatternInput is a typed
 * stub because gesture behavior has its own runtime tests; here we assert that
 * only one grid is staged at a time, confirmation mismatches never persist a
 * pattern, the current PIN is still required, and backgrounding clears drafts.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createHarness, loadTsModule, mobileRoot } = require('./support/screen-harness.cjs');

const PIN = '246813';
const PATTERN = Object.freeze([0, 1, 2, 5]);
const MISMATCH = Object.freeze([0, 1, 2, 5, 8]);

const lockPattern = loadTsModule(path.join(mobileRoot, 'utils/lockPattern.ts'), (name) => {
  throw new Error(`Unexpected module in lock pattern helpers: ${name}`);
});

function createSettingsHarness(overrides = {}, behavior = {}) {
  const lockState = {
    ready: true,
    supported: true,
    enabled: true,
    locked: false,
    covered: false,
    busy: false,
    patternEnabled: false,
    biometricsEnabled: false,
    error: null,
    retryAt: 0,
    failedAttempts: 0,
    storageError: false,
    ...overrides,
  };
  const calls = {
    alerts: [],
    setAppLockPattern: [],
    enableAppLock: [],
    disableAppLock: [],
    changeAppLockPin: [],
    setAppLockBiometrics: [],
    hydrateAppLock: 0,
    biometricChecks: 0,
  };

  const service = {
    getAppLockState: () => lockState,
    subscribeAppLock: () => () => {},
    hydrateAppLock: async () => { calls.hydrateAppLock += 1; },
    enableAppLock: async (...args) => { calls.enableAppLock.push(args); },
    disableAppLock: async (...args) => { calls.disableAppLock.push(args); },
    changeAppLockPin: async (...args) => { calls.changeAppLockPin.push(args); },
    setAppLockBiometrics: async (...args) => { calls.setAppLockBiometrics.push(args); },
    setAppLockPattern: async (...args) => {
      calls.setAppLockPattern.push(args);
      if (behavior.failPattern) throw behavior.failPattern;
      if (lockState.patternEnabled === false) lockState.patternEnabled = true;
    },
    getBiometricAvailability: async () => {
      calls.biometricChecks += 1;
      return false;
    },
  };

  const alert = {
    alert(title, message, buttons) {
      calls.alerts.push({ title, message, buttons });
    },
  };

  const harness = createHarness({
    componentPath: 'app/app-lock.tsx',
    modules: {
      '../services/appAlert': { AppAlert: alert },
      '../services/appLock': service,
      '../utils/lockPattern': lockPattern,
    },
  });

  return { harness, calls, lockState };
}

function patternInputs(harness) {
  return harness.allByType('PatternInput');
}

function assertSingleGrid(harness, label) {
  const grids = patternInputs(harness);
  assert.equal(grids.length, 1, 'exactly one pattern grid must be staged');
  assert.equal(grids[0].props.accessibilityLabel, label);
}

function assertNoTapMode(harness) {
  const labels = harness.elements()
    .map((element) => String(element.props.accessibilityLabel || ''))
    .join(' | ');
  assert.equal(/mode ketuk|mode garis sentuh|ketuk titik/i.test(labels), false, labels);
}

async function startSetup(harness) {
  await harness.press('Atur pola kunci');
  assert.equal(harness.textMatching(/Langkah 1 dari 2/), 'Langkah 1 dari 2');
}

test('setup stages one drag grid at a time and exposes no tap mode controls', async () => {
  const { harness } = createSettingsHarness();
  await harness.mount();

  assert.equal(patternInputs(harness).length, 0, 'no grid before setup starts');

  await startSetup(harness);
  assertSingleGrid(harness, 'Pola baru 3x3');
  assertNoTapMode(harness);
  assert.equal(
    harness.byLabel('Lanjut ke konfirmasi pola').props.disabled,
    true,
    'an empty pattern must not advance',
  );

  harness.patternChange('Pola baru 3x3', [0, 1, 2]);
  assert.equal(
    harness.byLabel('Lanjut ke konfirmasi pola').props.disabled,
    true,
    'fewer than four nodes must not advance',
  );

  harness.patternChange('Pola baru 3x3', PATTERN);
  assert.equal(harness.byLabel('Lanjut ke konfirmasi pola').props.disabled, false);
  await harness.press('Lanjut ke konfirmasi pola');

  assertSingleGrid(harness, 'Konfirmasi pola baru 3x3');
  assert.equal(
    harness.byLabel('Konfirmasi pola baru 3x3').props.value.length,
    0,
    'the repeat stage starts empty',
  );
  assert.equal(harness.byLabel('Pola baru 3x3'), undefined, 'the first grid is unmounted');
});

test('a mismatch keeps the repeat stage open, clears it, and never saves', async () => {
  const { harness, calls } = createSettingsHarness();
  await harness.mount();
  await startSetup(harness);
  harness.patternChange('Pola baru 3x3', PATTERN);
  await harness.press('Lanjut ke konfirmasi pola');

  harness.change('PIN saat ini untuk menyimpan pola', PIN);
  harness.patternChange('Konfirmasi pola baru 3x3', MISMATCH);
  await harness.press('Aktifkan pola kunci');

  assert.equal(calls.setAppLockPattern.length, 0, 'mismatched patterns must not persist');
  assert.ok(harness.textMatching(/tidak cocok/), 'mismatch must be explained');
  const all = harness.elements();
  const gridIndex = all.findIndex(
    (element) => element.props.accessibilityLabel === 'Konfirmasi pola baru 3x3',
  );
  const errorIndex = all.findIndex(
    (element, index) => index > gridIndex && element.type === 'Text' &&
      JSON.stringify(element.children).includes('tidak cocok'),
  );
  assert.ok(errorIndex > gridIndex, 'the mismatch error must render inline on the repeat step');
  assert.equal(harness.byLabel('Konfirmasi pola baru 3x3').props.value.length, 0);
  assertSingleGrid(harness, 'Konfirmasi pola baru 3x3');

  harness.patternChange('Konfirmasi pola baru 3x3', PATTERN);
  await harness.press('Aktifkan pola kunci');
  assert.deepEqual(calls.setAppLockPattern, [[PIN, PATTERN]]);
  assert.equal(calls.alerts.length, 1);
  assert.equal(patternInputs(harness).length, 0, 'saving returns to the summary');
  assert.ok(harness.byLabel('Ubah pola kunci'), 'the summary now offers an update');
});

test('a wrong current PIN keeps both patterns in one repeat grid and a retry succeeds', async () => {
  const behavior = { failPattern: new Error('PIN saat ini salah.') };
  const { harness, calls } = createSettingsHarness({}, behavior);
  await harness.mount();
  await startSetup(harness);
  harness.patternChange('Pola baru 3x3', PATTERN);
  await harness.press('Lanjut ke konfirmasi pola');
  harness.patternChange('Konfirmasi pola baru 3x3', PATTERN);
  harness.change('PIN saat ini untuk menyimpan pola', PIN);

  await harness.press('Aktifkan pola kunci');

  assert.equal(calls.setAppLockPattern.length, 1);
  assertSingleGrid(harness, 'Konfirmasi pola baru 3x3');
  assert.equal(harness.byLabel('Pola baru 3x3'), undefined, 'the draw grid stays unmounted');
  assert.equal(
    harness.byLabel('Konfirmasi pola baru 3x3').props.value.length,
    PATTERN.length,
    'a wrong PIN must not discard the confirmed pattern',
  );
  const all = harness.elements();
  const gridIndex = all.findIndex(
    (element) => element.props.accessibilityLabel === 'Konfirmasi pola baru 3x3',
  );
  const errorIndex = all.findIndex(
    (element, index) => index > gridIndex && element.type === 'Text' &&
      JSON.stringify(element.children).includes('PIN saat ini salah'),
  );
  assert.ok(errorIndex > gridIndex, 'the error renders beside the repeat-step save controls');
  assert.equal(harness.byLabel('PIN saat ini untuk menyimpan pola').props.value, '',
    'only the wrong PIN is cleared');

  behavior.failPattern = null;
  harness.change('PIN saat ini untuk menyimpan pola', PIN);
  await harness.press('Aktifkan pola kunci');

  assert.deepEqual(calls.setAppLockPattern.at(-1), [PIN, PATTERN]);
  assert.equal(calls.alerts.length, 1);
  assert.equal(patternInputs(harness).length, 0, 'success returns to the summary');
});

test('cooldown or storage failures abandon the wizard and show the summary error', async () => {
  const behavior = { failPattern: new Error('Terlalu banyak percobaan.') };
  const { harness, calls, lockState } = createSettingsHarness({}, behavior);
  await harness.mount();
  await startSetup(harness);
  harness.patternChange('Pola baru 3x3', PATTERN);
  await harness.press('Lanjut ke konfirmasi pola');
  harness.patternChange('Konfirmasi pola baru 3x3', PATTERN);
  harness.change('PIN saat ini untuk menyimpan pola', PIN);
  lockState.retryAt = Date.now() + 30_000;

  await harness.press('Aktifkan pola kunci');

  assert.equal(calls.setAppLockPattern.length, 1);
  assert.equal(patternInputs(harness).length, 0, 'cooldown returns to the summary');
  assert.ok(harness.textMatching(/Terlalu banyak percobaan/));
  assert.ok(harness.byLabel('Atur pola kunci'));
  harness.unmount();
});

test('the current PIN remains required after both patterns match', async () => {
  const { harness, calls } = createSettingsHarness();
  await harness.mount();
  await startSetup(harness);
  harness.patternChange('Pola baru 3x3', PATTERN);
  await harness.press('Lanjut ke konfirmasi pola');
  harness.patternChange('Konfirmasi pola baru 3x3', PATTERN);

  await harness.press('Aktifkan pola kunci');

  assert.equal(calls.setAppLockPattern.length, 0);
  assert.ok(harness.textMatching(/PIN saat ini \(6 digit\)/));
  assert.equal(harness.byLabel('Konfirmasi pola baru 3x3').props.value.length, PATTERN.length);
});

test('redraw and cancel reset the drafts without persisting anything', async () => {
  const { harness, calls } = createSettingsHarness();
  await harness.mount();
  await startSetup(harness);
  harness.patternChange('Pola baru 3x3', PATTERN);
  await harness.press('Lanjut ke konfirmasi pola');
  harness.patternChange('Konfirmasi pola baru 3x3', PATTERN);

  await harness.press('Gambar ulang pola pertama');
  assertSingleGrid(harness, 'Pola baru 3x3');
  assert.equal(harness.byLabel('Pola baru 3x3').props.value.length, 0);
  assert.equal(harness.byLabel('Konfirmasi pola baru 3x3'), undefined);

  harness.patternChange('Pola baru 3x3', PATTERN);
  await harness.press('Lanjut ke konfirmasi pola');
  harness.patternChange('Konfirmasi pola baru 3x3', PATTERN);
  await harness.press('Batal');

  assert.equal(patternInputs(harness).length, 0, 'cancel returns to the summary');
  assert.equal(calls.setAppLockPattern.length, 0);
  assert.ok(harness.byLabel('Atur pola kunci'));
});

test('backgrounding the app clears wizard drafts and secrets', async () => {
  const { harness, calls } = createSettingsHarness();
  await harness.mount();
  await startSetup(harness);
  harness.patternChange('Pola baru 3x3', PATTERN);
  await harness.press('Lanjut ke konfirmasi pola');
  assert.ok(
    harness.byLabel('PIN saat ini untuk menyimpan pola'),
    'the repeat step must show its own current PIN field',
  );
  harness.change('PIN saat ini untuk menyimpan pola', PIN);
  harness.patternChange('Konfirmasi pola baru 3x3', PATTERN);

  harness.appState.emit('background');
  harness.flush();

  assert.equal(patternInputs(harness).length, 0, 'backgrounding abandons the wizard');
  assert.equal(harness.byLabel('PIN saat ini').props.value, '', 'PIN draft must be cleared');
  assert.equal(calls.setAppLockPattern.length, 0);
  assert.ok(harness.byLabel('Atur pola kunci'), 'summary is restored');
});