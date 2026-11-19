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
    patternLinesVisible: true, ...behavior.state,
  };
  const calls = { pattern: [], pin: [], biometrics: 0, signOut: 0 };
  const service = {
    getAppLockState: () => state,
    subscribeAppLock: () => () => {},
    getBiometricAvailability: async () => true,
    hydrateAppLock: async () => {},
    unlockWithPattern: async (pattern) => {
      calls.pattern.push(Array.from(pattern));
      if (behavior.pending) await behavior.pending.promise;
      if (behavior.patternError) throw new Error('Pattern verification failed.');
      if (behavior.patternResult === false) {
        state.failedAttempts += 1;
        state.error = 'Pola salah.';
        return false;
      }
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

test('locked pattern drawing suspends scrolling and verifies only on release completion', async (t) => {
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
  await completion(harness)(PATTERN);
  await harness.settle();
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
  drawing(harness, false);
  await completion(harness)(PATTERN);
  await harness.settle();
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

function completion(harness) {
  const grid = harness.byLabel('Pola buka kunci aplikasi');
  assert.equal(typeof grid.props.onComplete, 'function', 'unlock must opt in to release completion');
  return grid.props.onComplete;
}

function deferredUnlock() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('pattern unlock never renders a submit button in empty, drawing, complete, error, cooldown, or busy states', async (t) => {
  const now = 1_900_000_000_000;
  t.mock.method(Date, 'now', () => now);
  for (const phase of ['empty', 'drawing', 'complete', 'error', 'cooldown', 'busy']) {
    const { harness, state, calls } = unlockHarness(t, { patternResult: false });
    await harness.mount();
    assert.ok(harness.byLabel('Buka kunci'), 'PIN mode retains its submit button');
    assert.ok(harness.textMatching(/Masukkan PIN 6 digit untuk membuka catatan keuanganmu/), 'PIN keeps its existing instruction');
    await harness.press('Gunakan pola kunci');
    if (phase === 'drawing' || phase === 'complete') drawing(harness, true);
    if (phase === 'drawing' || phase === 'complete') harness.patternChange('Pola buka kunci aplikasi', PATTERN);
    if (phase === 'complete') {
      drawing(harness, false);
      assert.deepEqual(harness.byLabel('Pola buka kunci aplikasi').props.value, PATTERN);
    }
    if (phase === 'error') {
      await completion(harness)(PATTERN);
      await harness.settle();
      assert.deepEqual(calls.pattern, [PATTERN]);
      assert.equal(state.failedAttempts, 1);
      assert.ok(harness.textMatching(/Pola salah/));
    }
    if (phase === 'cooldown') state.retryAt = now + 30_000;
    if (phase === 'busy') state.busy = true;
    harness.flush();
    assert.equal(harness.byLabel('Pola buka kunci aplikasi').props.showClearButton, false, `${phase} must not render the repeat button`);
    assert.equal(harness.textMatching(/Connect at least four dots/), undefined, `${phase} must not render the removed instruction`);
    assert.equal(harness.byLabel('Buka kunci dengan pola'), undefined, `${phase} must not render pattern submit`);
    assert.equal(harness.byLabel('Buka kunci'), undefined, `${phase} must not render PIN submit in pattern mode`);
    assert.ok(harness.byLabel('Gunakan PIN 6 digit'), `${phase} retains the PIN fallback`);
    assert.ok(harness.byLabel('Gunakan sidik jari / biometrik'), `${phase} retains the biometric fallback`);
    harness.unmount();
  }
});

test('release completion verifies its snapshot rather than an older rendered pattern draft', async (t) => {
  const { harness, state, calls } = unlockHarness(t);
  await harness.mount();
  await harness.press('Gunakan pola kunci');
  harness.patternChange('Pola buka kunci aplikasi', [0, 1, 2, 5]);
  assert.deepEqual(calls.pattern, [], 'node changes never verify');
  assert.equal(harness.byLabel('Buka kunci dengan pola'), undefined, 'pattern verification has no manual submit button');
  assert.ok(harness.byLabel('Gunakan PIN 6 digit'), 'PIN remains the accessibility fallback');
  await completion(harness)(PATTERN);
  await harness.settle();
  assert.deepEqual(calls.pattern, [PATTERN]);
  assert.equal(state.locked, false);
  assert.equal(scrolling(harness), true);
});

test('empty, short, and noncanonical release candidates are rejected locally without using attempt budget', async (t) => {
  const { harness, state, calls } = unlockHarness(t);
  await harness.mount();
  await harness.press('Gunakan pola kunci');
  for (const candidate of [[], [0], [0, 3, 6], [0, 2, 5, 8]]) {
    await completion(harness)(candidate);
    await harness.settle();
    assert.deepEqual(calls.pattern, []);
    assert.equal(state.failedAttempts, 0);
    assert.equal(state.locked, true);
    assert.ok(harness.textMatching(/minimal 4 titik/));
  }
});

test('repeated release completion stays single flight and blocks PIN switching and biometric actions while pending', async (t) => {
  const pending = deferredUnlock();
  const { harness, calls } = unlockHarness(t, { pending });
  t.after(() => pending.resolve());
  await harness.mount();
  await harness.press('Gunakan pola kunci');
  harness.patternChange('Pola buka kunci aplikasi', PATTERN);
  const release = completion(harness);
  const switchToPin = harness.byLabel('Gunakan PIN 6 digit').props.onPress;
  const biometric = harness.byLabel('Gunakan sidik jari / biometrik').props.onPress;
  release(PATTERN);
  await release([0, 1, 2, 5]);
  await switchToPin();
  await biometric();
  harness.flush();
  await completion(harness)(PATTERN);
  await switchToPin();
  await biometric();
  assert.deepEqual(calls.pattern, [PATTERN], 'only one proof may reach the service before or after rerender');
  assert.deepEqual(calls.pin, []);
  assert.equal(calls.biometrics, 0, 'the synchronous action lock prevents a second authentication method');
  assert.ok(harness.byLabel('Pola buka kunci aplikasi'), 'PIN switching stays blocked until verification settles');
  pending.resolve();
  await harness.settle();
  await release(PATTERN);
  await harness.settle();
  assert.deepEqual(calls.pattern, [PATTERN], 'a successful unlock cannot verify an old proof again');
});

test('obsolete release callbacks stay rejected after method switch, background, or unmount', async (t) => {
  for (const reason of ['switch', 'background', 'unmount']) {
    const { harness, calls } = unlockHarness(t);
    await harness.mount();
    await harness.press('Gunakan pola kunci');
    const stale = completion(harness);
    harness.patternChange('Pola buka kunci aplikasi', PATTERN);
    if (reason === 'switch') await harness.press('Gunakan PIN 6 digit');
    else if (reason === 'background') { harness.appState.emit('background'); harness.flush(); }
    else harness.unmount();
    await stale(PATTERN);
    await harness.settle();
    assert.deepEqual(calls.pattern, [], reason);
    if (reason !== 'unmount') {
      harness.appState.emit('active');
      harness.flush();
      await harness.press('Gunakan pola kunci');
      await stale(PATTERN);
      await harness.settle();
      assert.deepEqual(calls.pattern, [], `${reason} must not revive a disposed grid callback`);
    }
    harness.unmount();
  }
});

test('release checks live safety state before rendering can catch up, including cooldown and external busy', async (t) => {
  const now = 1_900_000_000_000;
  t.mock.method(Date, 'now', () => now);
  for (const patch of [
    { ready: false }, { enabled: false }, { locked: false }, { covered: true },
    { patternEnabled: false }, { busy: true }, { retryAt: now + 30_000 }, { storageError: true },
  ]) {
    const { harness, state, calls } = unlockHarness(t);
    await harness.mount();
    await harness.press('Gunakan pola kunci');
    const release = completion(harness);
    Object.assign(state, patch);
    await release(PATTERN);
    harness.flush();
    assert.deepEqual(calls.pattern, [], JSON.stringify(patch));
    assert.equal(state.failedAttempts, 0);
    harness.unmount();
  }
});

test('unlock line visibility is explicit, while rejected and failed release proofs remain useful for retry', async (t) => {
  for (const patternLinesVisible of [undefined, true, false]) {
    const behavior = { state: { patternLinesVisible }, patternResult: false };
    const { harness, state, calls } = unlockHarness(t, behavior);
    await harness.mount();
    await harness.press('Gunakan pola kunci');
    assert.equal(harness.byLabel('Pola buka kunci aplikasi').props.showLines, patternLinesVisible !== false);
    harness.patternChange('Pola buka kunci aplikasi', PATTERN);
    await completion(harness)(PATTERN);
    await harness.settle();
    assert.deepEqual(calls.pattern, [PATTERN]);
    assert.equal(state.failedAttempts, 1, 'only the authoritative service increments attempt count');
    assert.equal(state.locked, true);
    assert.equal(harness.byLabel('Pola buka kunci aplikasi').props.value.length, 0);
    assert.ok(harness.textMatching(/Pola salah/));
    behavior.patternResult = true;
    state.error = null;
    harness.patternChange('Pola buka kunci aplikasi', PATTERN);
    await completion(harness)(PATTERN);
    await harness.settle();
    assert.deepEqual(calls.pattern, [PATTERN, PATTERN]);
    assert.equal(state.locked, false);
    harness.unmount();
  }
});
