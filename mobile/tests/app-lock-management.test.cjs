/** Runtime coverage for PIN-backed app-lock management, without native UI claims. */
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createHarness, loadTsModule, mobileRoot, tokenProxy } = require('./support/screen-harness.cjs');

const PIN = '246813';
const NEXT_PIN = '135790';
const mutations = ['enableAppLock', 'changeAppLockPin', 'setAppLockBiometrics',
  'setAppLockPattern', 'disableAppLock'];

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function managementHarness(t, overrides = {}, behavior = {}) {
  const state = {
    ready: true, supported: true, enabled: true, locked: false, covered: false,
    busy: false, patternEnabled: false, biometricsEnabled: false, error: null,
    retryAt: 0, failedAttempts: 0, storageError: false, ...overrides,
  };
  const calls = Object.fromEntries(mutations.map((name) => [name, []]));
  calls.alerts = [];
  calls.back = 0;
  calls.biometricChecks = 0;
  let focusCallback;
  let focusCleanup;
  const service = {
    getAppLockState: () => state,
    subscribeAppLock: () => () => {},
    hydrateAppLock: async () => {},
    getBiometricAvailability: async () => {
      calls.biometricChecks += 1;
      if (behavior.availabilityError) throw behavior.availabilityError;
      return behavior.available ?? false;
    },
  };
  for (const name of mutations) {
    service[name] = async (...args) => {
      calls[name].push(args);
      if (behavior.pending?.[name]) await behavior.pending[name].promise;
      if (behavior.errors?.[name]) throw behavior.errors[name];
      if (name !== 'enableAppLock' && args[0] !== PIN) {
        throw new Error('PIN saat ini salah.');
      }
      if (name === 'enableAppLock') state.enabled = true;
      if (name === 'disableAppLock') {
        state.enabled = false;
        state.patternEnabled = false;
        state.biometricsEnabled = false;
      }
      if (name === 'setAppLockBiometrics') state.biometricsEnabled = args[1];
      if (name === 'setAppLockPattern') state.patternEnabled = args[1] !== null;
    };
  }
  const alertService = behavior.realAlerts
    ? loadTsModule(path.join(mobileRoot, 'services/appAlert.ts'), (name) => {
      if (name === './appLock') return service;
      if (name === './session') return { isAuthenticated: () => true, subscribeSession: () => () => {} };
      throw new Error(`Unexpected module in app alert service: ${name}`);
    })
    : null;
  const harness = createHarness({
    componentPath: 'app/app-lock.tsx',
    modules: {
      'react-native': { Keyboard: { dismiss() {} } },
      '../utils/motion': { useReducedMotion: () => behavior.reducedMotion ?? false },
      '../services/appLock': service,
      '../services/appAlert': { AppAlert: {
        alert: (title, message, buttons, options) => {
          calls.alerts.push({ title, message, buttons, options });
          alertService?.AppAlert.alert(title, message, buttons, options);
        },
      } },
      'expo-router': {
        router: { back: () => { calls.back += 1; } },
        useFocusEffect: (callback) => {
          focusCallback = callback;
          harness.React.useEffect(() => {
            focusCleanup = callback();
            return () => { focusCleanup?.(); focusCleanup = undefined; };
          }, [callback]);
        },
      },
    },
  });
  t.after(() => harness.unmount());
  return {
    harness, state, calls, behavior, alertService,
    blur() { focusCleanup?.(); focusCleanup = undefined; harness.flush(); },
    async focus() { focusCleanup = focusCallback(); harness.flush(); await harness.settle(); },
  };
}

function actualAlertHost(t, context) {
  assert.ok(context.alertService, 'host tests must use the real alert service');
  const backListeners = new Set();
  const host = createHarness({
    componentPath: 'components/security/AppAlertHost.tsx',
    exportName: 'AppAlertHost',
    props: { host: 'root' },
    modules: {
      '../../services/appAlert': context.alertService,
      '../../utils/theme': { Colors: tokenProxy(), Space: tokenProxy(), Type: tokenProxy() },
      '../ui/Button': { Button: (props) => host.h('Pressable', {
        ...props, accessibilityLabel: props.title, disabled: Boolean(props.disabled || props.loading),
      }) },
      'react-native': {
        ScrollView: 'ScrollView',
        BackHandler: {
          addEventListener(type, callback) {
            assert.equal(type, 'hardwareBackPress');
            backListeners.add(callback);
            return { remove: () => backListeners.delete(callback) };
          },
        },
      },
    },
  });
  t.after(() => host.unmount());
  return {
    host,
    requestAndroidBack() {
      assert.equal(backListeners.size, 1, 'the actual host must register its Android dismissal handler');
      assert.equal([...backListeners][0](), true, 'the alert host must consume Android back');
      host.flush();
      context.harness.flush();
    },
  };
}

function mutationCount(calls) {
  return mutations.reduce((total, name) => total + calls[name].length, 0);
}

function fillChange(harness, current = PIN, next = NEXT_PIN, confirm = next) {
  harness.change('PIN saat ini', current);
  harness.change('PIN baru 6 digit', next);
  harness.change('Konfirmasi PIN baru', confirm);
}

function destructivePrompt(calls) {
  const prompt = calls.alerts.at(-1);
  assert.ok(prompt?.buttons, 'destructive mutation requires a confirmation prompt');
  assert.ok(prompt.buttons.some((button) => button.style === 'cancel'));
  const confirm = prompt.buttons.find((button) => button.style === 'destructive');
  assert.equal(typeof confirm?.onPress, 'function');
  return { prompt, confirm };
}

async function confirmDestruction(harness, calls) {
  destructivePrompt(calls).confirm.onPress();
  harness.flush();
  await harness.settle();
}

function assertOverview(harness) {
  assert.equal(harness.allByType('Input').length, 0, 'overview must not collect any credential');
  assert.equal(harness.allByType('PatternInput').length, 0);
  assert.ok(harness.byLabel('Ganti PIN'), 'overview must offer a focused PIN-change action');
}

async function openChange(harness) {
  await harness.press('Ganti PIN');
  assert.deepEqual(harness.allByType('Input').map((field) => field.props.accessibilityLabel),
    ['PIN saat ini', 'PIN baru 6 digit', 'Konfirmasi PIN baru']);
}

async function invalidate(context, reason) {
  const { harness, state } = context;
  if (reason === 'blur') context.blur();
  else if (reason === 'background' || reason === 'inactive') harness.appState.emit(reason);
  else state[reason] = true;
  harness.flush();
  if (reason === 'blur') await context.focus();
  else if (reason === 'background' || reason === 'inactive') harness.appState.emit('active');
  else state[reason] = false;
  harness.flush();
  await harness.settle();
}

test('PIN change passes current and new PIN exactly once and reports success', async (t) => {
  const { harness, calls } = managementHarness(t);
  await harness.mount();
  await openChange(harness);
  fillChange(harness);
  await harness.press('Simpan PIN baru');
  assert.deepEqual(calls.changeAppLockPin, [[PIN, NEXT_PIN]]);
  assert.equal(mutationCount(calls), 1);
  assert.equal(calls.alerts[0].title, 'PIN diperbarui');
});

test('PIN change rejects missing, short, and non-ASCII current credentials', async (t) => {
  const { harness, calls } = managementHarness(t);
  await harness.mount();
  await openChange(harness);
  for (const current of ['', '24681', '２４６８１３']) {
    fillChange(harness, current);
    await harness.press('Simpan PIN baru');
    assert.equal(mutationCount(calls), 0);
    assert.ok(harness.textMatching(/PIN saat ini.*6 digit/));
  }
});

test('PIN change rejects short new PIN, short confirmation, and mismatches', async (t) => {
  const { harness, calls } = managementHarness(t);
  await harness.mount();
  await openChange(harness);
  for (const [next, confirm, error] of [
    ['13579', NEXT_PIN, /PIN baru.*6 digit/],
    [NEXT_PIN, '13579', /Konfirmasi PIN baru.*6 digit/],
    [NEXT_PIN, PIN, /tidak cocok/],
  ]) {
    fillChange(harness, PIN, next, confirm);
    await harness.press('Simpan PIN baru');
    assert.equal(mutationCount(calls), 0);
    assert.ok(harness.textMatching(error));
  }
});

test('PIN inputs strip non-ASCII characters and truncate to six ASCII digits', async (t) => {
  const { harness, calls } = managementHarness(t);
  await harness.mount();
  await openChange(harness);
  fillChange(harness, '２a2 4-6.8x1🙂3９7', '1a3 5-7.9x0🙂8', '1a3 5-7.9x0🙂8');
  for (const label of ['PIN saat ini', 'PIN baru 6 digit', 'Konfirmasi PIN baru']) {
    const field = harness.byLabel(label);
    assert.match(field.props.value, /^[0-9]{6}$/);
    assert.equal(field.props.secureTextEntry, true);
    assert.equal(field.props.maxLength, 6);
  }
  await harness.press('Simpan PIN baru');
  assert.deepEqual(calls.changeAppLockPin, [[PIN, NEXT_PIN]]);
});

test('wrong current PIN never reports a successful PIN change', async (t) => {
  const { harness, calls } = managementHarness(t);
  await harness.mount();
  await openChange(harness);
  fillChange(harness, '111111');
  await harness.press('Simpan PIN baru');
  assert.deepEqual(calls.changeAppLockPin, [['111111', NEXT_PIN]]);
  assert.equal(calls.alerts.length, 0);
  assert.ok(harness.textMatching(/PIN saat ini salah/));
});

test('service failure explains the PIN-change error and clears current credentials', async (t) => {
  const { harness, calls } = managementHarness(t, {}, {
    errors: { changeAppLockPin: new Error('Penyimpanan aman gagal.') },
  });
  await harness.mount();
  await openChange(harness);
  fillChange(harness);
  await harness.press('Simpan PIN baru');
  assert.equal(calls.alerts.length, 0);
  assert.ok(harness.textMatching(/Penyimpanan aman gagal/));
  assert.equal(harness.byLabel('PIN saat ini').props.value, '');
});

test('unavailable or failed biometric discovery never offers biometric activation', async (t) => {
  const { harness, calls } = managementHarness(t, {}, {
    availabilityError: new Error('Native discovery unavailable'),
  });
  await harness.mount();
  assert.equal(calls.biometricChecks, 1);
  assert.equal(harness.byLabel('Sidik jari / biometrik').props.disabled, true);
  harness.byLabel('Sidik jari / biometrik').props.onPress();
  harness.flush();
  assertOverview(harness);
  assert.equal(harness.byLabel('Enable biometrics'), undefined);
  assert.equal(calls.setAppLockBiometrics.length, 0);
  assert.ok(harness.textMatching(/Not available.*Enroll biometrics/));
});

test('available biometrics require current PIN and enable with the explicit true argument', async (t) => {
  const { harness, calls } = managementHarness(t, {}, { available: true });
  await harness.mount();
  await harness.press('Sidik jari / biometrik');
  await harness.press('Enable biometrics');
  assert.equal(calls.setAppLockBiometrics.length, 0);
  assert.ok(harness.textMatching(/PIN saat ini.*6 digit/));
  harness.change('PIN saat ini', PIN);
  await harness.press('Enable biometrics');
  assert.deepEqual(calls.setAppLockBiometrics, [[PIN, true]]);
  assert.equal(mutationCount(calls), 1);
  assert.equal(calls.alerts[0].title, 'Biometrik diaktifkan');
});

test('enabled biometrics can be disabled with PIN even when hardware becomes unavailable', async (t) => {
  const { harness, calls, state } = managementHarness(t, { biometricsEnabled: true });
  await harness.mount();
  await harness.press('Sidik jari / biometrik');
  harness.change('PIN saat ini', PIN);
  await harness.press('Disable biometrics');
  assert.deepEqual(calls.setAppLockBiometrics, [[PIN, false]]);
  assert.equal(state.enabled, true, 'PIN lock remains mandatory');
  assert.equal(calls.disableAppLock.length, 0);
});

test('pattern removal requires PIN and destructive confirmation while preserving PIN lock', async (t) => {
  const { harness, calls, state } = managementHarness(t, { patternEnabled: true });
  await harness.mount();
  await harness.press('Hapus pola kunci');
  await harness.press('Hapus pola kunci');
  assert.equal(calls.alerts.length, 0);
  assert.ok(harness.textMatching(/PIN saat ini.*6 digit/));
  harness.change('PIN saat ini', PIN);
  await harness.press('Hapus pola kunci');
  assert.equal(mutationCount(calls), 0, 'prompt alone must not mutate');
  assert.match(destructivePrompt(calls).prompt.message, /PIN 6 digit tetap/);
  await confirmDestruction(harness, calls);
  assert.deepEqual(calls.setAppLockPattern, [[PIN, null]]);
  assert.equal(state.enabled, true);
  assert.equal(calls.disableAppLock.length, 0);
});

test('disabling entire lock requires PIN and explicit destructive confirmation', async (t) => {
  const { harness, calls, state } = managementHarness(t, {
    patternEnabled: true, biometricsEnabled: true,
  });
  await harness.mount();
  await harness.press('Nonaktifkan kunci aplikasi');
  await harness.press('Nonaktifkan kunci aplikasi');
  assert.equal(calls.alerts.length, 0);
  harness.change('PIN saat ini', PIN);
  await harness.press('Nonaktifkan kunci aplikasi');
  assert.equal(mutationCount(calls), 0);
  assert.match(destructivePrompt(calls).prompt.message, /PIN, pola kunci.*biometrik.*dihapus/);
  await confirmDestruction(harness, calls);
  assert.deepEqual(calls.disableAppLock, [[PIN]]);
  assert.equal(state.enabled, false);
  assert.equal(state.patternEnabled, false);
  assert.equal(state.biometricsEnabled, false);
});

test('cancelling a destructive alert clears credentials and revokes its callback even after reopening', async (t) => {
  for (const action of ['Hapus pola kunci', 'Nonaktifkan kunci aplikasi']) {
    const { harness, calls, state } = managementHarness(t, { patternEnabled: true });
    await harness.mount();
    await harness.press(action);
    harness.change('PIN saat ini', PIN);
    await harness.press(action);
    const { prompt, confirm } = destructivePrompt(calls);
    prompt.buttons.find((button) => button.style === 'cancel').onPress?.();
    harness.flush();
    await harness.settle();
    assert.ok(harness.allByType('Input').every((field) => field.props.value === ''),
      'alert cancellation must clear every live credential draft');
    confirm.onPress();
    harness.flush();
    await harness.settle();
    assert.equal(mutationCount(calls), 0, 'a cancelled alert cannot reuse its captured PIN');
    if (harness.byLabel('Batal')) await harness.press('Batal');
    assertOverview(harness);
    await harness.press(action);
    harness.change('PIN saat ini', PIN);
    confirm.onPress();
    harness.flush();
    await harness.settle();
    assert.equal(mutationCount(calls), 0, 'reopening cannot revive a cancelled alert callback');
    assert.equal(state.patternEnabled, true);
    assert.equal(state.enabled, true);
    harness.unmount();
  }
});

test('enabled overview exposes status and focused actions but no credentials or standalone PIN removal', async (t) => {
  const { harness, calls } = managementHarness(t, { patternEnabled: true, biometricsEnabled: true });
  await harness.mount();
  assertOverview(harness);
  assert.ok(harness.byLabel('Ubah pola kunci'));
  assert.ok(harness.byLabel('Hapus pola kunci'));
  assert.ok(harness.byLabel('Nonaktifkan kunci aplikasi'));
  const labels = harness.elements().map((element) => element.props.accessibilityLabel || '').join(' | ');
  assert.doesNotMatch(labels, /hapus PIN|nonaktifkan PIN/i);
  assert.ok(harness.textMatching(/PIN is always available as your fallback/));
  assert.match(harness.byLabel('Ganti PIN').props.accessibilityHint, /Active and required as your fallback/);
  assert.equal(mutationCount(calls), 0);
});

test('focused PIN change hides other mutations and cancel or back clears all drafts', async (t) => {
  const { harness, calls } = managementHarness(t, {}, { available: true });
  await harness.mount();
  for (const exit of ['Batal', 'Kembali']) {
    await openChange(harness);
    fillChange(harness);
    for (const label of ['Atur pola kunci', 'Sidik jari / biometrik', 'Nonaktifkan kunci aplikasi']) {
      assert.equal(harness.byLabel(label), undefined, `other mutation ${label} must be hidden`);
    }
    await harness.press(exit);
    assertOverview(harness);
    await openChange(harness);
    assert.ok(harness.allByType('Input').every((field) => field.props.value === ''));
    await harness.press('Batal');
  }
  assert.equal(calls.back, 0, 'back from a management flow returns to overview, not the router');
  assert.equal(mutationCount(calls), 0);
});

test('pending PIN change blocks editing, cancellation, back, and duplicate or alternate mutations', async (t) => {
  const pending = deferred();
  const { harness, calls } = managementHarness(t, {}, {
    available: true, pending: { changeAppLockPin: pending },
  });
  await harness.mount();
  await openChange(harness);
  fillChange(harness);
  const submit = harness.byLabel('Simpan PIN baru').props.onPress;
  const back = harness.byLabel('Kembali').props.onPress;
  const cancel = harness.byLabel('Batal').props.onPress;
  const operation = submit();
  t.after(() => pending.resolve());
  harness.flush();
  assert.ok(harness.allByType('Input').every((field) => field.props.editable === false));
  for (const label of ['Simpan PIN baru', 'Kembali', 'Batal']) {
    assert.equal(harness.byLabel(label).props.disabled, true, `${label} must be disabled while submitting`);
  }
  await submit();
  back();
  cancel();
  harness.flush();
  assert.equal(harness.allByType('Input').length, 3, 'stale navigation handlers must not close a pending flow');
  assert.equal(mutationCount(calls), 1);
  assert.equal(calls.back, 0);
  pending.resolve();
  await operation;
  await harness.settle();
  assertOverview(harness);
  assert.deepEqual(calls.changeAppLockPin, [[PIN, NEXT_PIN]]);
});

test('blur, background, inactive, covered, and locked clear the active view and every PIN draft', async (t) => {
  for (const reason of ['blur', 'background', 'inactive', 'covered', 'locked']) {
    const context = managementHarness(t);
    const { harness, calls } = context;
    await harness.mount();
    await openChange(harness);
    fillChange(harness);
    await invalidate(context, reason);
    assertOverview(harness);
    await openChange(harness);
    assert.ok(harness.allByType('Input').every((field) => field.props.value === ''), reason);
    await harness.press('Simpan PIN baru');
    assert.equal(mutationCount(calls), 0, `${reason} must clear refs as well as visible fields`);
    harness.unmount();
  }
});

test('saved destructive callbacks cannot execute after cancellation, reopening, or duplicate confirmation', async (t) => {
  for (const action of ['Hapus pola kunci', 'Nonaktifkan kunci aplikasi']) {
    const { harness, calls } = managementHarness(t, { patternEnabled: true });
    await harness.mount();
    await harness.press(action);
    harness.change('PIN saat ini', PIN);
    await harness.press(action);
    const stale = destructivePrompt(calls).confirm.onPress;
    await harness.press('Batal');
    assertOverview(harness);
    await harness.press(action);
    harness.change('PIN saat ini', PIN);
    stale();
    harness.flush();
    await harness.settle();
    assert.equal(mutationCount(calls), 0, 'reopening must not reactivate an old confirmation');
    await harness.press(action);
    const fresh = destructivePrompt(calls).confirm.onPress;
    fresh();
    harness.flush();
    await harness.settle();
    fresh();
    await harness.settle();
    assert.equal(mutationCount(calls), 1, 'a confirmation is one-shot');
    harness.unmount();
  }
});

test('saved destructive callbacks stay revoked after lifecycle clearing and refocus', async (t) => {
  for (const [index, reason] of ['blur', 'background', 'inactive', 'covered', 'locked'].entries()) {
    const context = managementHarness(t, { patternEnabled: true });
    const { harness, calls } = context;
    const action = index % 2 === 0 ? 'Hapus pola kunci' : 'Nonaktifkan kunci aplikasi';
    await harness.mount();
    await harness.press(action);
    harness.change('PIN saat ini', PIN);
    await harness.press(action);
    const stale = destructivePrompt(calls).confirm.onPress;
    await invalidate(context, reason);
    stale();
    harness.flush();
    await harness.settle();
    assert.equal(mutationCount(calls), 0, `${reason} must revoke captured PIN authorization`);
    assertOverview(harness);
    await harness.press(action);
    harness.change('PIN saat ini', PIN);
    stale();
    harness.flush();
    await harness.settle();
    assert.equal(mutationCount(calls), 0, `${reason} must revoke captured PIN authorization`);
    harness.unmount();
  }
});

test('cooldown abandons drafts, disables every mutation, shows seconds, and rejects stale confirmation', async (t) => {
  const now = 1_900_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const { harness, calls, state } = managementHarness(t, { patternEnabled: true, biometricsEnabled: true });
  await harness.mount();
  await harness.press('Nonaktifkan kunci aplikasi');
  harness.change('PIN saat ini', PIN);
  await harness.press('Nonaktifkan kunci aplikasi');
  const stale = destructivePrompt(calls).confirm.onPress;
  state.retryAt = now + 30_000;
  harness.flush();
  await harness.settle();
  stale();
  await harness.settle();
  assert.equal(mutationCount(calls), 0, 'cooldown must block previously captured destructive handlers');
  assertOverview(harness);
  assert.ok(harness.textMatching(/Coba lagi dalam/));
  assert.ok(harness.texts().join(' ').match(/30\s+detik/));
  for (const label of ['Ganti PIN', 'Ubah pola kunci', 'Hapus pola kunci', 'Sidik jari / biometrik', 'Nonaktifkan kunci aplikasi']) {
    assert.equal(harness.byLabel(label).props.disabled, true, `${label} must respect cooldown`);
  }
  stale();
  await harness.settle();
  assert.equal(mutationCount(calls), 0);
  state.retryAt = 0;
  harness.flush();
  await harness.settle();
  await harness.press('Nonaktifkan kunci aplikasi');
  harness.change('PIN saat ini', PIN);
  stale();
  await harness.settle();
  assert.equal(mutationCount(calls), 0, 'expired cooldown must not revive stale authorization');
});

test('external busy state prevents opening every mutation without collecting credentials', async (t) => {
  const { harness, calls } = managementHarness(t, { busy: true, patternEnabled: true, biometricsEnabled: true });
  await harness.mount();
  assertOverview(harness);
  for (const label of ['Ganti PIN', 'Ubah pola kunci', 'Hapus pola kunci', 'Sidik jari / biometrik', 'Nonaktifkan kunci aplikasi']) {
    const action = harness.byLabel(label);
    assert.equal(action.props.disabled, true);
    action.props.onPress();
  }
  harness.flush();
  assertOverview(harness);
  assert.equal(mutationCount(calls), 0);
});

test('unsupported app-lock storage exposes no credential or mutation controls', async (t) => {
  const { harness, calls } = managementHarness(t, { supported: false });
  await harness.mount();
  assert.equal(harness.allByType('Input').length, 0);
  assert.equal(calls.biometricChecks, 0);
  assert.ok(harness.textMatching(/Tidak didukung/));
  assert.equal(harness.byLabel('Ganti PIN'), undefined);
  assert.equal(harness.byLabel('Nonaktifkan kunci aplikasi'), undefined);
  assert.equal(mutationCount(calls), 0);
});

test('initial PIN activation rejects missing, short, non-ASCII, and mismatched confirmation credentials', async (t) => {
  const { harness, calls, state } = managementHarness(t, { enabled: false });
  await harness.mount();
  assert.equal(harness.allByType('Input').length, 0);
  await harness.press('Aktifkan PIN 6 digit');
  assert.deepEqual(harness.allByType('Input').map((field) => field.props.accessibilityLabel),
    ['PIN baru 6 digit', 'Konfirmasi PIN baru']);
  for (const [pin, confirmation, error] of [
    ['', '', /PIN.*6 digit/],
    ['24681', PIN, /PIN.*6 digit/],
    ['２４６８１３', PIN, /PIN.*6 digit/],
    [PIN, '', /Konfirmasi PIN.*6 digit/],
    [PIN, '24681', /Konfirmasi PIN.*6 digit/],
    [PIN, '２４６８１３', /Konfirmasi PIN.*6 digit/],
    [PIN, NEXT_PIN, /tidak cocok/],
  ]) {
    harness.change('PIN baru 6 digit', pin);
    harness.change('Konfirmasi PIN baru', confirmation);
    await harness.press('Aktifkan kunci aplikasi');
    assert.equal(mutationCount(calls), 0);
    assert.equal(calls.alerts.length, 0);
    assert.equal(state.enabled, false);
    assert.ok(harness.textMatching(error));
  }
});

test('initial PIN activation sanitizes six ASCII digits and enables only mandatory PIN fallback once', async (t) => {
  const { harness, calls, state } = managementHarness(t, { enabled: false }, { available: true });
  await harness.mount();
  await harness.press('Aktifkan PIN 6 digit');
  for (const label of ['PIN baru 6 digit', 'Konfirmasi PIN baru']) {
    harness.change(label, '２a2 4-6.8x1🙂3９7');
    assert.equal(harness.byLabel(label).props.value, PIN);
    assert.equal(harness.byLabel(label).props.secureTextEntry, true);
  }
  await harness.press('Aktifkan kunci aplikasi');
  assert.deepEqual(calls.enableAppLock, [[PIN]]);
  assert.equal(mutationCount(calls), 1, 'initial setup must not silently enable pattern or biometrics');
  assert.equal(state.enabled, true);
  assert.equal(state.patternEnabled, false);
  assert.equal(state.biometricsEnabled, false);
  assert.equal(calls.alerts.length, 1);
  assert.equal(calls.alerts[0].title, 'Kunci aplikasi aktif');
  assertOverview(harness);
});

test('initial PIN activation reports fallback service errors and clears secrets before a useful retry', async (t) => {
  const behavior = { errors: { enableAppLock: 'native storage unavailable' } };
  const { harness, calls, state } = managementHarness(t, { enabled: false }, behavior);
  await harness.mount();
  await harness.press('Aktifkan PIN 6 digit');
  harness.change('PIN baru 6 digit', PIN);
  harness.change('Konfirmasi PIN baru', PIN);
  await harness.press('Aktifkan kunci aplikasi');
  assert.equal(calls.alerts.length, 0);
  assert.equal(state.enabled, false);
  assert.ok(harness.textMatching(/Gagal mengaktifkan kunci aplikasi/));
  assert.ok(harness.allByType('Input').every((field) => field.props.value === ''));
  assert.equal(harness.byLabel('Aktifkan kunci aplikasi').props.disabled, false);
  behavior.errors.enableAppLock = null;
  harness.change('PIN baru 6 digit', PIN);
  harness.change('Konfirmasi PIN baru', PIN);
  await harness.press('Aktifkan kunci aplikasi');
  assert.deepEqual(calls.enableAppLock, [[PIN], [PIN]]);
  assert.equal(calls.alerts.length, 1);
  assert.equal(state.enabled, true);
});

for (const outcome of ['success', 'error']) {
  test(`pending PIN activation suppresses stale ${outcome} after blur, background, or unmount`, async (t) => {
    for (const reason of ['background', 'blur', 'unmount']) {
      const pending = deferred();
      const context = managementHarness(t, { enabled: false }, {
        pending: { enableAppLock: pending },
        errors: outcome === 'error' ? { enableAppLock: new Error('Stale native result must stay hidden.') } : {},
      });
      const { harness, calls, state } = context;
      await harness.mount();
      await harness.press('Aktifkan PIN 6 digit');
      harness.change('PIN baru 6 digit', PIN);
      harness.change('Konfirmasi PIN baru', PIN);
      const operation = harness.byLabel('Aktifkan kunci aplikasi').props.onPress();
      t.after(() => pending.resolve());
      harness.flush();
      assert.deepEqual(calls.enableAppLock, [[PIN]]);
      if (reason === 'unmount') harness.unmount();
      else if (reason === 'blur') context.blur();
      else { harness.appState.emit('background'); harness.flush(); }
      if (reason !== 'unmount') {
        assert.ok(harness.allByType('Input').every((field) => field.props.value === ''),
          `${reason} must clear secrets before the dependency resolves`);
      }
      pending.resolve();
      await operation;
      await harness.settle();
      assert.equal(calls.alerts.length, 0, `${reason} must suppress stale success alerts`);
      assert.equal(harness.textMatching(/Stale native result must stay hidden/), undefined,
        `${reason} must suppress stale service errors`);
      assert.equal(mutationCount(calls), 1);
      if (reason === 'unmount') {
        const returned = managementHarness(t, { ...state });
        await returned.harness.mount();
        assert.equal(returned.calls.alerts.length, 0);
        if (outcome === 'success') assertOverview(returned.harness);
        else assert.ok(returned.harness.allByType('Input').every((field) => field.props.value === ''));
      } else {
        if (reason === 'blur') await context.focus();
        else { harness.appState.emit('active'); harness.flush(); await harness.settle(); }
        if (outcome === 'success') assertOverview(harness);
        else assert.ok(harness.allByType('Input').every((field) => field.props.value === ''));
      }
      harness.unmount();
    }
  });
}

for (const action of ['Hapus pola kunci', 'Nonaktifkan kunci aplikasi']) {
  test(`Android back from the actual alert host revokes ${action}, while fresh selection mutates once`, async (t) => {
    const context = managementHarness(t, { patternEnabled: true }, { realAlerts: true });
    const { harness, calls, state, alertService } = context;
    const { host, requestAndroidBack } = actualAlertHost(t, context);
    await harness.mount();
    await host.mount();
    await harness.press(action);
    harness.change('PIN saat ini', PIN);
    await harness.press(action);
    host.flush();
    assert.ok(host.byLabel(action === 'Hapus pola kunci' ? 'Hapus pola' : 'Nonaktifkan'));
    const saved = alertService.getAppAlert().buttons.find((button) => button.style === 'destructive').onPress;

    requestAndroidBack();
    assert.equal(alertService.getAppAlert(), null, 'Android back must dismiss the real dialog');
    assertOverview(harness);
    assert.equal(host.elements().length, 0);
    await saved();
    harness.flush();
    await harness.settle();
    assert.equal(mutationCount(calls), 0, 'Android dismissal must revoke the captured confirmation');

    await harness.press(action);
    assert.equal(harness.byLabel('PIN saat ini').props.value, '', 'reopening must not retain the dismissed PIN');
    harness.change('PIN saat ini', PIN);
    await saved();
    harness.flush();
    await harness.settle();
    assert.equal(mutationCount(calls), 0, 'a new live PIN must not revive an old dismissed confirmation');
    await harness.press(action);
    host.flush();
    const fresh = alertService.getAppAlert().buttons.find((button) => button.style === 'destructive').onPress;
    await host.press(action === 'Hapus pola kunci' ? 'Hapus pola' : 'Nonaktifkan');
    await harness.settle();
    assert.equal(mutationCount(calls), 1, 'actual button selection must not trigger dismissal cancellation');
    if (action === 'Hapus pola kunci') {
      assert.deepEqual(calls.setAppLockPattern, [[PIN, null]]);
      assert.equal(state.enabled, true);
      assertOverview(harness);
    } else {
      assert.deepEqual(calls.disableAppLock, [[PIN]]);
      assert.equal(state.enabled, false);
      assert.equal(harness.allByType('Input').length, 0);
      assert.ok(harness.byLabel('Aktifkan PIN 6 digit'));
    }
    assert.equal(state.patternEnabled, false);
    assert.equal(alertService.getAppAlert().title,
      action === 'Hapus pola kunci' ? 'Pola kunci dihapus' : 'Kunci aplikasi dinonaktifkan');
    await fresh();
    await harness.settle();
    assert.equal(mutationCount(calls), 1, 'the selected confirmation must remain one-shot');
  });
}

test('press feedback preserves opacity but omits scaling when reduced motion is requested', async (t) => {
  for (const reducedMotion of [false, true]) {
    const { harness, calls } = managementHarness(t, {}, { reducedMotion });
    await harness.mount();
    const assertFeedback = (label) => {
      const control = harness.byLabel(label);
      assert.equal(typeof control.props.style, 'function');
      const pressed = Object.assign({}, ...control.props.style({ pressed: true }).filter(Boolean));
      const resting = Object.assign({}, ...control.props.style({ pressed: false }).filter(Boolean));
      assert.equal(resting.transform, undefined, 'resting controls must not scale');
      assert.ok(pressed.opacity > 0 && pressed.opacity < 1, 'non-motion press feedback remains visible');
      if (reducedMotion) assert.equal(pressed.transform, undefined);
      else {
        assert.equal(pressed.transform.length, 1);
        assert.equal(pressed.transform[0].scale, 0.98);
      }
    };
    assertFeedback('Kembali');
    assertFeedback('Ganti PIN');
    await openChange(harness);
    assertFeedback('Simpan PIN baru');
    assert.equal(mutationCount(calls), 0, 'evaluating press styles must not invoke actions');
    harness.unmount();
  }
});
