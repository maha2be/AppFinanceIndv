/** Unlock-screen scroll arbitration, without claiming native gesture acceptance. */
const assert = require('node:assert/strict');
const test = require('node:test');
const { createHarness, tokenProxy } = require('./support/screen-harness.cjs');

const PATTERN = [0, 3, 6, 7];

function unlockHarness(t, behavior = {}) {
  const state = {
    ready: true, supported: true, enabled: true, locked: true, covered: false,
    busy: false, patternEnabled: true, biometricsEnabled: true, error: null,
    storageError: false, retryAt: 0, failedAttempts: 0,
  };
  const calls = { pattern: [], pin: [], biometrics: 0, signOut: 0 };
  const service = {
    getAppLockState: () => state,
    subscribeAppLock: () => () => {},
    getBiometricAvailability: async () => true,
    hydrateAppLock: async () => {},
    unlockWithPattern: async (pattern) => {
      calls.pattern.push(Array.from(pattern));
      if (behavior.patternError) throw new Error('Pattern verification failed.');
      state.locked = false;
      return true;
    },
    unlockWithPin: async (pin) => { calls.pin.push(pin); return true; },
    unlockWithBiometrics: async () => { calls.biometrics += 1; return true; },
  };
  const harness = createHarness({
    componentPath: 'components/security/AppLockView.tsx',
    exportName: 'AppLockView',
    props: { onSignOut: async () => { calls.signOut += 1; } },
    modules: {
      'react-native': { Alert: { alert() {} } },
      '../../services/appLock': service,
      '../../utils/theme': {
        Colors: tokenProxy(), Fonts: tokenProxy(), Radius: tokenProxy(), Space: tokenProxy(), Type: tokenProxy(),
      },
      '../ui/Screen': { Screen: (props) => harness.h('UnlockScreen', props, props.children) },
      '../ui/Input': { Input: (props) => harness.h('Input', props) },
      '../ui/Button': { Button: (props) => harness.h('Pressable', {
        ...props, accessibilityLabel: props.title, disabled: Boolean(props.disabled || props.loading),
      }) },
      './PatternInput': { PatternInput: (props) => harness.h('PatternInput', props) },
    },
  });
  t.after(() => harness.unmount());
  return { harness, state, calls };
}

function scrolling(harness) {
  return harness.byType('UnlockScreen').props.scrollEnabled;
}

function drawing(harness, active) {
  const grid = harness.byLabel('Pola buka kunci aplikasi');
  assert.equal(typeof grid.props.onDrawingChange, 'function');
  grid.props.onDrawingChange(active);
  harness.flush();
}

test('locked pattern drawing suspends scrolling until release without auto-unlocking', async (t) => {
  const { harness, calls } = unlockHarness(t);
  await harness.mount();
  assert.equal(scrolling(harness), true);
  await harness.press('Gunakan pola kunci');
  drawing(harness, true);
  assert.equal(scrolling(harness), false);
  harness.patternChange('Pola buka kunci aplikasi', PATTERN);
  assert.equal(scrolling(harness), false, 'node updates cannot release the active gesture');
  assert.deepEqual(calls.pattern, [], 'drawing alone never submits unlock proof');
  drawing(harness, false);
  assert.equal(scrolling(harness), true);
  assert.deepEqual(harness.byLabel('Pola buka kunci aplikasi').props.value, PATTERN);
  await harness.press('Buka kunci dengan pola');
  assert.deepEqual(calls.pattern, [PATTERN]);
  assert.equal(scrolling(harness), true);
});

test('switching from an active pattern to PIN restores scrolling and rejects obsolete drawing callbacks', async (t) => {
  const { harness, calls } = unlockHarness(t);
  await harness.mount();
  await harness.press('Gunakan pola kunci');
  const stale = harness.byLabel('Pola buka kunci aplikasi').props.onDrawingChange;
  drawing(harness, true);
  harness.patternChange('Pola buka kunci aplikasi', PATTERN);
  await harness.press('Gunakan PIN 6 digit');
  assert.equal(scrolling(harness), true);
  assert.equal(harness.byLabel('Pola buka kunci aplikasi'), undefined);
  assert.equal(harness.byLabel('PIN 6 digit').props.value, '');
  stale(true);
  harness.flush();
  assert.equal(scrolling(harness), true, 'an unmounted pattern grid cannot freeze PIN entry');
  harness.change('PIN 6 digit', '246813');
  await harness.press('Buka kunci');
  assert.deepEqual(calls.pin, ['246813']);
  assert.deepEqual(calls.pattern, []);
});

test('privacy changes and disabled input restore scrolling during an active unlock gesture', async (t) => {
  const now = 1_900_000_000_000;
  t.mock.method(Date, 'now', () => now);
  for (const reason of ['background', 'inactive', 'covered', 'unlocked', 'not-ready', 'storage-error', 'pattern-removed', 'cooldown', 'busy']) {
    const { harness, state, calls } = unlockHarness(t);
    await harness.mount();
    await harness.press('Gunakan pola kunci');
    const stale = harness.byLabel('Pola buka kunci aplikasi').props.onDrawingChange;
    drawing(harness, true);
    harness.patternChange('Pola buka kunci aplikasi', PATTERN);
    if (reason === 'background' || reason === 'inactive') harness.appState.emit(reason);
    else if (reason === 'covered') state.covered = true;
    else if (reason === 'unlocked') state.locked = false;
    else if (reason === 'not-ready') state.ready = false;
    else if (reason === 'storage-error') { state.storageError = true; state.error = 'Secure storage unavailable.'; }
    else if (reason === 'pattern-removed') state.patternEnabled = false;
    else if (reason === 'cooldown') state.retryAt = now + 30_000;
    else state.busy = true;
    harness.flush();
    stale(true);
    harness.flush();
    assert.notEqual(scrolling(harness), false, `${reason} cannot retain a drawing scroll lock`);
    Object.assign(state, {
      ready: true, locked: true, covered: false, storageError: false, error: null,
      patternEnabled: true, retryAt: 0, busy: false,
    });
    harness.appState.emit('active');
    harness.flush();
    assert.equal(scrolling(harness), true, `${reason} must leave scrolling restored after recovery`);
    assert.deepEqual(calls.pattern, []);
    harness.unmount();
  }
});

test('pattern verification failure clears the draft and restores scrolling for retry', async (t) => {
  const { harness, calls } = unlockHarness(t, { patternError: true });
  await harness.mount();
  await harness.press('Gunakan pola kunci');
  drawing(harness, true);
  harness.patternChange('Pola buka kunci aplikasi', PATTERN);
  await harness.press('Buka kunci dengan pola');
  assert.deepEqual(calls.pattern, [PATTERN]);
  assert.equal(scrolling(harness), true);
  assert.equal(harness.byLabel('Pola buka kunci aplikasi').props.value.length, 0);
  assert.ok(harness.textMatching(/Pattern verification failed/));
});

test('ending a drawing gesture preserves the existing biometric unlock action', async (t) => {
  const { harness, calls } = unlockHarness(t);
  await harness.mount();
  await harness.press('Gunakan pola kunci');
  drawing(harness, true);
  drawing(harness, false);
  assert.equal(scrolling(harness), true);
  await harness.press('Gunakan sidik jari / biometrik');
  assert.equal(calls.biometrics, 1);
  assert.deepEqual(calls.pattern, []);
});

test('obsolete drawing callbacks cannot update a disposed unlock screen', async (t) => {
  const { harness, calls } = unlockHarness(t);
  await harness.mount();
  await harness.press('Gunakan pola kunci');
  const stale = harness.byLabel('Pola buka kunci aplikasi').props.onDrawingChange;
  drawing(harness, true);
  harness.unmount();
  assert.doesNotThrow(() => { stale(false); stale(true); });
  assert.deepEqual(calls.pattern, []);
});
