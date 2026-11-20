/**
 * Runtime regressions for the Settings stack screen (`app/settings.tsx`).
 * Shared components are contract doubles; the actual screen supplies every
 * action, branch, and confirmation.
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const { createHarness, tokenProxy } = require('./support/screen-harness.cjs');

function node(type, props = {}) {
  const children = props.children === undefined ? [] : [props.children].flat(Infinity);
  return { type, props, children };
}

const stub = (type) => (props) => node(type, props);

function profile(overrides = {}) {
  return {
    id: 7,
    first_name: 'Ayu',
    email: 'ayu@example.test',
    currency: 'IDR',
    timezone: 'Asia/Jakarta',
    telegram_linked: false,
    google_linked: false,
    has_password: true,
    ...overrides,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function apiError(message) {
  return { response: { data: { detail: message } } };
}

function createSettingsHarness(options = {}) {
  const dimensions = { width: 390, height: 844, scale: 1, fontScale: 1, ...options.dimensions };
  let focusCallback;
  let focusCleanup;
  const calls = {
    getProfile: 0,
    createTelegramLinkToken: 0,
    unlinkTelegram: 0,
    googleAvailability: 0,
    back: 0,
    alerts: [],
    pushes: [],
    replacements: [],
    describedErrors: [],
    themeModes: [],
  };
  let themeMode = options.themeMode || 'light';
  const themeColors = (mode) => ({
    paper: mode === 'dark' ? '#141613' : '#F2F0E9',
    surface: mode === 'dark' ? '#1C1F1B' : '#FBFAF5',
    surfaceAlt: mode === 'dark' ? '#252923' : '#EBE8DE',
    line: mode === 'dark' ? '#31362E' : '#DAD5C7',
    lineStrong: mode === 'dark' ? '#454C41' : '#C9C2B0',
    ink: mode === 'dark' ? '#F2EFE6' : '#171A16',
    inkSoft: mode === 'dark' ? '#C4C2B8' : '#565A52',
    inkMuted: mode === 'dark' ? '#9B9A90' : '#64685E',
    onInk: mode === 'dark' ? '#171A16' : '#F7F5EE',
    danger: mode === 'dark' ? '#E56E6E' : '#A32B2B',
    dangerTint: mode === 'dark' ? 'rgba(229, 110, 110, 0.16)' : 'rgba(163, 43, 43, 0.10)',
    inkTint: mode === 'dark' ? 'rgba(242, 239, 230, 0.08)' : 'rgba(23, 26, 22, 0.06)',
  });
  const lockState = {
    ready: true,
    supported: true,
    enabled: false,
    patternEnabled: false,
    biometricsEnabled: false,
    ...options.lockState,
  };
  const behavior = {
    getProfile: async () => profile(options.user),
    createTelegramLinkToken: async () => ({ code: '012345', expires_in_minutes: 1 }),
    unlinkTelegram: async () => {},
    googleAvailability: async () => options.googleAvailable ?? true,
    ...options.behavior,
  };
  const authApi = {};
  for (const method of ['getProfile', 'createTelegramLinkToken', 'unlinkTelegram']) {
    authApi[method] = (...args) => {
      calls[method] += 1;
      return behavior[method](...args);
    };
  }
  const harness = createHarness({
    componentPath: 'app/settings.tsx',
    modules: {
      'expo-router': {
        useFocusEffect: (callback) => {
          focusCallback = callback;
          harness.React.useEffect(() => {
            focusCleanup = callback();
            return () => {
              focusCleanup?.();
              focusCleanup = undefined;
            };
          }, [callback]);
        },
        router: {
          back: () => { calls.back += 1; },
          push: (route) => calls.pushes.push(route),
          replace: (route) => calls.replacements.push(route),
        },
      },
      'react-native': { useWindowDimensions: () => dimensions },
      '../utils/theme': {
        Colors: tokenProxy(),
        Fonts: tokenProxy(),
        Radius: tokenProxy(),
        Space: tokenProxy(),
        Type: tokenProxy(),
      },
      '../components/ui/Screen': { Screen: stub('Screen') },
      '../components/ui/FadeIn': { FadeIn: stub('FadeIn') },
      '../components/auth/LinkGoogleSheet': { LinkGoogleSheet: stub('LinkGoogleSheet') },
      '../services/appAlert': {
        AppAlert: {
          alert: (title, message, buttons) => calls.alerts.push({ title, message, buttons }),
        },
      },
      '../services/auth': {
        authApi,
        describeApiError: (error, fallback) => {
          calls.describedErrors.push({ error, fallback });
          return error?.response?.data?.detail || fallback;
        },
      },
      '../services/googleAuth': {
        isGoogleAuthAvailable: () => {
          calls.googleAvailability += 1;
          return behavior.googleAvailability();
        },
      },
      '../services/appLock': {
        getAppLockState: () => lockState,
        subscribeAppLock: () => () => {},
      },
      '../services/theme': {
        useTheme: () => ({
          mode: themeMode,
          isDark: themeMode === 'dark',
          colors: themeColors(themeMode),
          type: tokenProxy(),
          shadow: tokenProxy(),
          setThemeMode: async (next) => {
            calls.themeModes.push(next);
            themeMode = next;
            harness.flush();
          },
        }),
        createThemedStyles: (factory) => (theme) => factory(theme),
      },
    },
  });
  function blur() {
    focusCleanup?.();
    focusCleanup = undefined;
    harness.flush();
  }
  async function focus() {
    blur();
    focusCleanup = focusCallback();
    harness.flush();
    await harness.settle();
  }
  return { harness, calls, behavior, lockState, dimensions, blur, focus };
}

async function press(harness, label) {
  const control = harness.byLabel(label);
  assert.ok(control, `control ${label} must be rendered`);
  assert.notEqual(control.props.disabled, true, `control ${label} must be enabled`);
  assert.equal(typeof control.props.onPress, 'function', `${label} must be pressable`);
  const result = control.props.onPress();
  harness.flush();
  await result;
  await harness.settle();
}

function confirmation(calls) {
  const alert = calls.alerts.at(-1);
  assert.ok(alert, 'the action must display a confirmation');
  const cancel = alert.buttons?.find((button) => button.style === 'cancel');
  const confirm = alert.buttons?.find((button) => button.style === 'destructive');
  assert.ok(cancel, 'a cancellation option must be available');
  assert.equal(typeof confirm?.onPress, 'function', 'confirmation must own the destructive action');
  return { cancel, confirm };
}

async function retry(harness) {
  await press(harness, 'Coba lagi');
}

function textWithin(root) {
  if (Array.isArray(root)) return root.flatMap(textWithin);
  if (!root || typeof root !== 'object') return typeof root === 'string' ? [root] : [];
  return (root.children || []).flatMap(textWithin);
}

function sectionFor(harness, heading) {
  const section = harness.allByType('View').find((view) => view.children.some((child) =>
    child?.type === 'Text' && child.props.accessibilityRole === 'header' &&
    textWithin(child).includes(heading)));
  assert.ok(section, `${heading} must have its own section`);
  return section;
}

function contains(root, target) {
  if (root === target) return true;
  if (Array.isArray(root)) return root.some((child) => contains(child, target));
  return Boolean(root && typeof root === 'object' &&
    (root.children || []).some((child) => contains(child, target)));
}

function parentOf(harness, target) {
  const parent = harness.elements().find((element) => element.children.includes(target));
  assert.ok(parent, 'the control must have a containing group');
  return parent;
}

function flattenStyle(style) {
  if (Array.isArray(style)) {
    return style.reduce((result, entry) => ({ ...result, ...flattenStyle(entry) }), {});
  }
  return style && typeof style === 'object' ? style : {};
}

function detailRow(harness, label) {
  const row = harness.allByType('View').find((view) => view.children.some((child) =>
    child?.type === 'Text' && textWithin(child).includes(label)));
  assert.ok(row, `detail ${label} must be rendered`);
  return row;
}

function assertProfileActionsDisabled(harness) {
  for (const label of ['Change password', 'Delete account']) {
    assert.equal(harness.byLabel(label)?.props.disabled, true, `${label} must wait for current account details`);
  }
  const telegram = harness.byLabel('Hubungkan akun Telegram') || harness.byLabel('New Telegram link code');
  assert.equal(telegram?.props.disabled, true, 'Telegram must wait for current account details');
  const google = harness.byLabel('Tautkan akun Google');
  if (google) assert.equal(google.props.disabled, true);
}

test('profile loading shows placeholders in Preferences until the requested account arrives', async () => {
  const pending = deferred();
  const { harness, calls } = createSettingsHarness({
    behavior: { getProfile: () => pending.promise },
  });
  await harness.mount();

  assert.equal(calls.getProfile, 1);
  assert.equal(harness.byLabel('Coba lagi'), undefined);
  assert.equal(harness.texts().filter((text) => text === 'Loading...').length, 2);

  pending.resolve(profile({ currency: 'EUR', timezone: 'Europe/Paris' }));
  await harness.settle();

  assert.ok(harness.texts().includes('EUR'));
  assert.ok(harness.texts().includes('Europe/Paris'));
  assert.equal(harness.texts().includes('Loading...'), false);
});

test('empty optional profile fields retain safe display fallbacks', async () => {
  const { harness } = createSettingsHarness({
    user: { first_name: '', email: null, currency: '', timezone: '' },
  });
  await harness.mount();

  assert.equal(harness.texts().filter((text) => text === 'Not available').length, 2);
  assert.equal(harness.texts().includes('IDR'), false);
  assert.equal(harness.texts().includes('Asia/Jakarta'), false);
  assert.equal(harness.textMatching(/undefined|null/), undefined);
  assert.equal(harness.byLabel('Coba lagi'), undefined);
});

test('profile dependency failure shows its error and retry loads preferences', async () => {
  const failure = apiError('Profile temporarily unavailable.');
  const { harness, calls, behavior } = createSettingsHarness({
    behavior: { getProfile: async () => { throw failure; } },
  });
  await harness.mount();

  assert.ok(harness.texts().includes('Profile temporarily unavailable.'));
  assert.equal(harness.byLabel('Coba lagi').props.disabled, false);
  assert.equal(calls.describedErrors[0].error, failure);

  behavior.getProfile = async () => profile({ currency: 'JPY', timezone: 'Asia/Tokyo' });
  await retry(harness);

  assert.equal(calls.getProfile, 2);
  assert.equal(harness.byLabel('Coba lagi'), undefined);
  assert.ok(harness.texts().includes('JPY'));
  assert.ok(harness.texts().includes('Asia/Tokyo'));
});

test('a failed profile retry remains retryable without navigation or account mutations', async () => {
  const { harness, calls } = createSettingsHarness({
    behavior: { getProfile: async () => { throw new Error('network'); } },
  });
  await harness.mount();
  await retry(harness);

  assert.equal(calls.getProfile, 2);
  assert.ok(harness.texts().includes('Gagal memuat profil.'));
  assert.equal(harness.byLabel('Coba lagi').props.disabled, false);
  assert.equal(calls.createTelegramLinkToken, 0);
  assert.equal(calls.unlinkTelegram, 0);
  assert.deepEqual(calls.pushes, []);
  assert.deepEqual(calls.replacements, []);
});

test('back button returns to Saya without logging out or mutating integrations', async () => {
  const { harness, calls } = createSettingsHarness();
  await harness.mount();

  await press(harness, 'Kembali');
  assert.equal(calls.back, 1);
  assert.deepEqual(calls.pushes, []);
});

for (const [label, route] of [
  ['Kunci aplikasi', '/app-lock'],
  ['Change password', '/change-password'],
  ['Delete account', '/delete-account'],
]) {
  test(`${label} opens ${route} without mutating integrations`, async () => {
    const { harness, calls } = createSettingsHarness();
    await harness.mount();

    await press(harness, label);

    assert.deepEqual(calls.pushes, [route]);
    assert.deepEqual(calls.replacements, []);
    assert.equal(calls.unlinkTelegram, 0);
    assert.equal(calls.createTelegramLinkToken, 0);
  });
}

test('Telegram initial token preserves leading zeroes and expiry', async () => {
  const { harness, calls } = createSettingsHarness({
    user: { telegram_linked: false },
    behavior: { createTelegramLinkToken: async () => ({ code: '004219', expires_in_minutes: 10 }) },
  });
  await harness.mount();

  await press(harness, 'Hubungkan akun Telegram');

  assert.equal(calls.createTelegramLinkToken, 1);
  assert.equal(calls.alerts.length, 1);
  assert.equal(calls.alerts[0].title, 'Kode tautan Telegram');
  assert.match(calls.alerts[0].message, /\/link 004219/);
  assert.match(calls.alerts[0].message, /10 menit/);
});

test('Telegram replacement token preserves leading zeroes and expiry', async () => {
  const { harness, calls } = createSettingsHarness({
    user: { telegram_linked: true },
    behavior: { createTelegramLinkToken: async () => ({ code: '009901', expires_in_minutes: 15 }) },
  });
  await harness.mount();

  await press(harness, 'New Telegram link code');

  assert.equal(calls.createTelegramLinkToken, 1);
  assert.match(calls.alerts[0].message, /\/link 009901/);
  assert.match(calls.alerts[0].message, /15 menit/);
});

test('Telegram token generation disables its control until the request completes', async () => {
  const pending = deferred();
  const { harness, calls } = createSettingsHarness({
    behavior: { createTelegramLinkToken: () => pending.promise },
  });
  await harness.mount();

  const request = harness.byLabel('Hubungkan akun Telegram').props.onPress();
  harness.flush();
  assert.equal(harness.byLabel('Hubungkan akun Telegram').props.disabled, true);
  assert.equal(harness.byLabel('Hubungkan akun Telegram').props.accessibilityState.busy, true);

  await harness.byLabel('Hubungkan akun Telegram').props.onPress();
  assert.equal(calls.createTelegramLinkToken, 1);

  pending.resolve({ code: '654321', expires_in_minutes: 5 });
  await request;
  await harness.settle();
  assert.equal(harness.byLabel('Hubungkan akun Telegram').props.disabled, false);
  assert.equal(harness.byLabel('Hubungkan akun Telegram').props.accessibilityState.busy, false);
});

test('Telegram token dependency errors reset loading and permit a successful retry', async () => {
  let attempt = 0;
  const { harness, calls } = createSettingsHarness({
    behavior: {
      createTelegramLinkToken: async () => {
        attempt += 1;
        if (attempt === 1) throw apiError('Telegram service unavailable.');
        return { code: '777888', expires_in_minutes: 3 };
      },
    },
  });
  await harness.mount();

  await press(harness, 'Hubungkan akun Telegram');
  assert.equal(calls.alerts[0].title, 'Gagal membuat kode');
  assert.equal(calls.alerts[0].message, 'Telegram service unavailable.');
  assert.equal(harness.byLabel('Hubungkan akun Telegram').props.disabled, false);

  await press(harness, 'Hubungkan akun Telegram');
  assert.equal(calls.alerts[1].title, 'Kode tautan Telegram');
  assert.match(calls.alerts[1].message, /\/link 777888/);
});

test('Telegram token errors without server detail use the screen fallback', async () => {
  const { harness, calls } = createSettingsHarness({
    behavior: { createTelegramLinkToken: async () => { throw new Error('network'); } },
  });
  await harness.mount();

  await press(harness, 'Hubungkan akun Telegram');

  assert.equal(calls.alerts[0].title, 'Gagal membuat kode');
  assert.equal(calls.alerts[0].message, 'Coba lagi sebentar lagi.');
  assert.equal(calls.describedErrors.at(-1).fallback, 'Coba lagi sebentar lagi.');
});

test('unlinked Telegram accounts expose no unlink action', async () => {
  const { harness } = createSettingsHarness({ user: { telegram_linked: false } });
  await harness.mount();

  assert.ok(harness.byLabel('Hubungkan akun Telegram'));
  assert.equal(harness.byLabel('Putuskan tautan Telegram'), undefined);
});

test('canceling Telegram unlink preserves the linked profile without reloading', async () => {
  const { harness, calls } = createSettingsHarness({ user: { telegram_linked: true } });
  await harness.mount();

  await press(harness, 'Putuskan tautan Telegram');
  await confirmation(calls).cancel.onPress?.();

  assert.equal(calls.unlinkTelegram, 0);
  assert.equal(calls.getProfile, 1);
  assert.ok(harness.byLabel('Putuskan tautan Telegram'));
});

test('confirmed Telegram unlink waits for deletion and then reloads the authoritative profile', async () => {
  const { harness, calls, behavior } = createSettingsHarness({ user: { telegram_linked: true } });
  await harness.mount();
  behavior.getProfile = async () => profile({ telegram_linked: false });

  await press(harness, 'Putuskan tautan Telegram');
  await confirmation(calls).confirm.onPress();
  await harness.settle();

  assert.equal(calls.unlinkTelegram, 1);
  assert.equal(calls.getProfile, 2);
  assert.equal(harness.byLabel('Putuskan tautan Telegram'), undefined);
  assert.ok(harness.byLabel('Hubungkan akun Telegram'));
});

test('Telegram unlink failure preserves the linked account and supports confirmation retry', async () => {
  let attempt = 0;
  const { harness, calls, behavior } = createSettingsHarness({
    user: { telegram_linked: true },
    behavior: {
      unlinkTelegram: async () => {
        attempt += 1;
        if (attempt === 1) throw apiError('Could not unlink Telegram.');
      },
    },
  });
  await harness.mount();

  await press(harness, 'Putuskan tautan Telegram');
  await confirmation(calls).confirm.onPress();
  await harness.settle();

  assert.equal(calls.unlinkTelegram, 1);
  assert.equal(calls.getProfile, 1);
  assert.equal(calls.alerts.at(-1).title, 'Gagal memutus tautan');
  assert.equal(calls.alerts.at(-1).message, 'Could not unlink Telegram.');
  assert.ok(harness.byLabel('Putuskan tautan Telegram'));
  assert.ok(harness.byLabel('New Telegram link code'));

  behavior.unlinkTelegram = async () => {};
  behavior.getProfile = async () => profile();
  await press(harness, 'Putuskan tautan Telegram');
  await confirmation(calls).confirm.onPress();
  await harness.settle();

  assert.equal(calls.unlinkTelegram, 2);
  assert.equal(calls.getProfile, 2);
  assert.equal(harness.byLabel('Putuskan tautan Telegram'), undefined);
});

test('profile reload failure after Telegram unlink remains visible and retry does not unlink twice', async () => {
  const { harness, calls, behavior } = createSettingsHarness({ user: { telegram_linked: true } });
  await harness.mount();
  behavior.getProfile = async () => { throw apiError('Reload failed.'); };
  await press(harness, 'Putuskan tautan Telegram');
  await confirmation(calls).confirm.onPress();
  await harness.settle();

  assert.equal(calls.unlinkTelegram, 1);
  assert.ok(harness.texts().includes('Reload failed.'));
  assert.ok(harness.texts().includes('Account details unavailable.'));
  assert.equal(harness.byLabel('Change password').props.disabled, true);
  assert.equal(harness.byLabel('Delete account').props.disabled, true);
  assert.equal(harness.byLabel('Coba lagi').props.disabled, false);

  behavior.getProfile = async () => profile();
  await retry(harness);

  assert.equal(calls.unlinkTelegram, 1);
  assert.equal(calls.getProfile, 3);
  assert.equal(harness.byLabel('Coba lagi'), undefined);
  assert.equal(harness.byLabel('Putuskan tautan Telegram'), undefined);
});

test('a Google-linked account shows linked status even when native Google auth is unavailable', async () => {
  const { harness } = createSettingsHarness({
    user: { google_linked: true, has_password: false },
    googleAvailable: false,
  });
  await harness.mount();

  assert.ok(harness.texts().includes('Google tertaut'));
  assert.equal(harness.byLabel('Tautkan akun Google'), undefined);
  assert.equal(harness.byType('LinkGoogleSheet').props.visible, false);
  assert.match(textWithin(harness.byLabel('Change password')).join(' '), /Google/);
  await press(harness, 'Change password');
});

test('Google linking opens only for an available native module and a password account', async () => {
  const { harness, calls } = createSettingsHarness();
  await harness.mount();

  assert.equal(calls.googleAvailability, 1);
  assert.equal(harness.byType('LinkGoogleSheet').props.visible, false);
  await press(harness, 'Tautkan akun Google');

  assert.equal(harness.byType('LinkGoogleSheet').props.visible, true);
  assert.equal(calls.getProfile, 1);
  assert.deepEqual(calls.pushes, []);
  assert.equal(calls.createTelegramLinkToken, 0);
});

test('closing the Google sheet leaves profile and linked status unchanged', async () => {
  const { harness, calls } = createSettingsHarness();
  await harness.mount();
  await press(harness, 'Tautkan akun Google');

  harness.byType('LinkGoogleSheet').props.onClose();
  await harness.settle();

  assert.equal(harness.byType('LinkGoogleSheet').props.visible, false);
  assert.ok(harness.byLabel('Tautkan akun Google'));
  assert.equal(harness.texts().includes('Google tertaut'), false);
  assert.equal(calls.getProfile, 1);
});

test('Google onLinked replaces the profile and closes the sheet without another profile request', async () => {
  const { harness, calls } = createSettingsHarness();
  await harness.mount();
  await press(harness, 'Tautkan akun Google');

  harness.byType('LinkGoogleSheet').props.onLinked(profile({
    google_linked: true,
    currency: 'GBP',
    telegram_linked: true,
  }));
  await harness.settle();

  assert.equal(harness.byType('LinkGoogleSheet').props.visible, false);
  assert.ok(harness.texts().includes('Google tertaut'));
  assert.ok(harness.texts().includes('GBP'));
  assert.ok(harness.byLabel('New Telegram link code'));
  assert.equal(harness.byLabel('Tautkan akun Google'), undefined);
  assert.equal(calls.getProfile, 1);
});

for (const [name, options] of [
  ['native Google auth unavailable', { googleAvailable: false }],
  ['an unlinked account without a password', { user: { has_password: false } }],
]) {
  test(`${name} exposes no Google linking action`, async () => {
    const { harness, calls } = createSettingsHarness(options);
    await harness.mount();

    assert.equal(harness.byLabel('Tautkan akun Google'), undefined);
    assert.equal(harness.byType('LinkGoogleSheet').props.visible, false);
    assert.equal(harness.texts().includes('Google tertaut'), false);
    assert.equal(calls.getProfile, 1);
  });
}

test('Google linking remains unavailable until native capability discovery finishes', async () => {
  const pending = deferred();
  const { harness, calls } = createSettingsHarness({
    behavior: { googleAvailability: () => pending.promise },
  });
  await harness.mount();

  assert.equal(harness.byLabel('Tautkan akun Google'), undefined);
  assert.equal(harness.byType('LinkGoogleSheet').props.visible, false);
  pending.resolve(true);
  await harness.settle();

  assert.ok(harness.byLabel('Tautkan akun Google'));
  assert.equal(calls.googleAvailability, 1);
});

for (const [name, state, expected] of [
  ['loading', { ready: false, enabled: true, patternEnabled: true, biometricsEnabled: true }, /Memuat/],
  ['unsupported', { supported: false, enabled: true }, /Tidak tersedia/],
  ['disabled', { enabled: false, patternEnabled: true, biometricsEnabled: true }, /Nonaktif.*PIN 6 digit/],
  ['PIN only', { enabled: true }, /^Aktif · PIN 6 digit$/],
  ['PIN and pattern', { enabled: true, patternEnabled: true }, /^Aktif · PIN 6 digit dan pola kunci$/],
  ['PIN and biometrics', { enabled: true, biometricsEnabled: true }, /^Aktif · PIN 6 digit dan sidik jari \/ biometrik$/],
  ['PIN, pattern, and biometrics', { enabled: true, patternEnabled: true, biometricsEnabled: true }, /^Aktif · PIN 6 digit, pola kunci, dan sidik jari \/ biometrik$/],
]) {
  test(`device security summary distinguishes ${name}`, async () => {
    const { harness } = createSettingsHarness({ lockState: state });
    await harness.mount();

    const hint = textWithin(harness.byLabel('Kunci aplikasi')).find((text) => expected.test(text));
    assert.ok(hint, `device security must describe ${name}`);
    assert.equal(harness.byLabel('Coba lagi'), undefined);
  });
}

test('device security summary reads an updated app-lock snapshot on the next render', async () => {
  const { harness, lockState } = createSettingsHarness();
  await harness.mount();
  assert.match(textWithin(harness.byLabel('Kunci aplikasi')).join(' '), /Nonaktif/);

  Object.assign(lockState, { enabled: true, patternEnabled: true, biometricsEnabled: true });
  harness.flush();

  assert.match(textWithin(harness.byLabel('Kunci aplikasi')).join(' '), /PIN 6 digit, pola kunci, dan sidik jari/);
});

for (const [name, getProfile] of [
  ['pending', () => deferred().promise],
  ['failed', async () => { throw apiError('Profile unavailable.'); }],
  ['null', async () => null],
]) {
  test(`a ${name} profile cannot fire profile-specific settings actions`, async () => {
    const { harness, calls } = createSettingsHarness({ behavior: { getProfile } });
    await harness.mount();

    for (const label of ['Hubungkan akun Telegram', 'New Telegram link code', 'Putuskan tautan Telegram', 'Tautkan akun Google', 'Change password', 'Delete account']) {
      const control = harness.byLabel(label);
      if (!control) continue;
      assert.equal(control.props.disabled, true, `${label} must wait for a known profile`);
      await control.props.onPress();
      harness.flush();
    }
    assert.equal(calls.createTelegramLinkToken, 0);
    assert.equal(calls.unlinkTelegram, 0);
    assert.equal(harness.byType('LinkGoogleSheet').props.visible, false);
    assert.deepEqual(calls.pushes, []);
    assert.deepEqual(calls.alerts, [], 'even direct disabled-handler invocation must not start an account action');
    if (name === 'pending') {
      assert.ok(harness.texts().includes('Loading account details...'));
      assert.equal(harness.byLabel('Coba lagi'), undefined);
    } else {
      assert.ok(harness.texts().includes('Account details unavailable.'));
      assert.ok(harness.byLabel('Coba lagi'));
    }

    // Local security remains available without profile data.
    await press(harness, 'Kunci aplikasi');
    assert.deepEqual(calls.pushes, ['/app-lock']);
  });
}

test('security precedes connections and preferences, with actions in their intended sections', async () => {
  const { harness } = createSettingsHarness();
  await harness.mount();
  const security = sectionFor(harness, 'Account security');
  const connections = sectionFor(harness, 'Connected accounts');
  const preferences = sectionFor(harness, 'Preferences & app');
  const elements = harness.elements();

  assert.ok(elements.indexOf(security) < elements.indexOf(connections));
  assert.ok(elements.indexOf(connections) < elements.indexOf(preferences));
  assert.ok(contains(security, harness.byLabel('Kunci aplikasi')));
  assert.ok(contains(security, harness.byLabel('Change password')));
  assert.ok(contains(connections, harness.byLabel('Hubungkan akun Telegram')));
  assert.ok(contains(connections, harness.byLabel('Tautkan akun Google')));
  assert.ok(textWithin(preferences).includes('Tema tampilan'));
  assert.ok(textWithin(preferences).includes('Mata uang'));
  assert.ok(textWithin(preferences).includes('Zona waktu'));
  assert.equal(contains(security, harness.byLabel('Delete account')), false);
});

test('permanent deletion occupies a separate final group, isolated from ordinary settings', async () => {
  const { harness } = createSettingsHarness();
  await harness.mount();
  const deletion = sectionFor(harness, 'Permanent deletion');
  const deleteControl = harness.byLabel('Delete account');
  const elements = harness.elements();

  assert.ok(contains(deletion, deleteControl));
  assert.equal(harness.byLabel('Keluar dari akun'), undefined);
  for (const label of ['Kunci aplikasi', 'Change password', 'Hubungkan akun Telegram', 'Tautkan akun Google', 'Tema Light', 'Tema Dark']) {
    assert.equal(contains(deletion, harness.byLabel(label)), false, `${label} must remain outside permanent deletion`);
    assert.ok(elements.indexOf(deleteControl) > elements.indexOf(harness.byLabel(label)));
  }
  assert.ok(elements.indexOf(deletion) > elements.indexOf(sectionFor(harness, 'Preferences & app')));
  assert.equal(harness.elements().filter((element) => element.props.accessibilityLabel === 'Delete account').length, 1);
});

for (const [name, dimensions, direction] of [
  ['narrow viewport', { width: 359 }, 'column'],
  ['viewport boundary', { width: 360 }, 'row'],
  ['font-scale boundary', { width: 390, fontScale: 1.3 }, 'row'],
  ['large font', { width: 390, fontScale: 1.31 }, 'column'],
  ['wide viewport with large font', { width: 720, fontScale: 2 }, 'column'],
]) {
  test(`mocked ${name} selects the ${direction} detail layout cleanly`, async () => {
    const { harness } = createSettingsHarness({ dimensions });
    await harness.mount();

    for (const label of ['Mata uang', 'Zona waktu', 'Versi']) {
      const row = detailRow(harness, label);
      assert.equal(flattenStyle(row.props.style).flexDirection, direction);
      const value = row.children.find((child) => child?.type === 'Text' && !textWithin(child).includes(label));
      assert.equal(flattenStyle(value.props.style).textAlign, direction === 'column' ? 'left' : 'right');
    }
    const themeRow = parentOf(harness, detailRow(harness, 'Tema tampilan'));
    assert.equal(flattenStyle(themeRow.props.style).flexDirection, direction);
    assert.ok(harness.byLabel('Change password'));
    assert.ok(harness.byLabel('Delete account'));
  });
}

test('detail layout responds to mocked dimension changes without refetching the profile', async () => {
  const { harness, dimensions, calls } = createSettingsHarness();
  await harness.mount();
  assert.equal(flattenStyle(detailRow(harness, 'Zona waktu').props.style).flexDirection, 'row');

  dimensions.width = 320;
  harness.flush();
  assert.equal(flattenStyle(detailRow(harness, 'Zona waktu').props.style).flexDirection, 'column');

  Object.assign(dimensions, { width: 720, fontScale: 1 });
  harness.flush();
  assert.equal(flattenStyle(detailRow(harness, 'Zona waktu').props.style).flexDirection, 'row');
  assert.ok(harness.texts().includes('Asia/Jakarta'));
  assert.equal(calls.getProfile, 1);
});

test('inline profile retry reports loading, blocks account actions, and clears the original error on success', async () => {
  const pending = deferred();
  const { harness, calls, behavior } = createSettingsHarness({
    behavior: { getProfile: async () => { throw new Error('network'); } },
  });
  await harness.mount();
  assert.ok(harness.texts().includes('Gagal memuat profil.'));
  assert.equal(calls.describedErrors[0].fallback, 'Gagal memuat profil.');
  behavior.getProfile = () => pending.promise;

  const result = harness.byLabel('Coba lagi').props.onPress();
  harness.flush();
  assert.equal(calls.getProfile, 2);
  assert.equal(harness.byLabel('Coba lagi').props.disabled, true);
  assert.equal(harness.byLabel('Coba lagi').props.accessibilityState.busy, true);
  assert.ok(harness.texts().includes('Loading account details...'));
  assertProfileActionsDisabled(harness);
  await harness.byLabel('Coba lagi').props.onPress();
  assert.equal(calls.getProfile, 2, 'the disabled retry must not launch another request');

  pending.resolve(profile());
  await result;
  await harness.settle();
  assert.equal(harness.byLabel('Coba lagi'), undefined);
  assert.equal(harness.texts().includes('Gagal memuat profil.'), false);
  assert.equal(harness.texts().includes('Loading account details...'), false);
  assert.equal(harness.byLabel('Change password').props.disabled, false);
});

test('Telegram unlink keeps its busy state across deletion and profile reload, without duplicate mutations', async () => {
  const unlink = deferred();
  const reload = deferred();
  const { harness, calls, behavior } = createSettingsHarness({
    user: { telegram_linked: true },
    behavior: { unlinkTelegram: () => unlink.promise },
  });
  await harness.mount();
  await press(harness, 'Putuskan tautan Telegram');
  const confirm = confirmation(calls).confirm.onPress;
  const result = confirm();
  await confirm();
  harness.flush();

  assert.equal(calls.unlinkTelegram, 1);
  assert.equal(calls.getProfile, 1);
  assert.equal(harness.byLabel('Putuskan tautan Telegram').props.accessibilityState.busy, true);
  assertProfileActionsDisabled(harness);

  behavior.getProfile = () => reload.promise;
  unlink.resolve();
  await harness.settle();
  assert.equal(calls.getProfile, 2);
  assert.ok(harness.texts().includes('Loading account details...'));
  assert.equal(harness.byLabel('Putuskan tautan Telegram').props.accessibilityState.busy, true);
  assertProfileActionsDisabled(harness);

  reload.resolve(profile({ telegram_linked: false }));
  await result;
  await harness.settle();
  assert.equal(calls.unlinkTelegram, 1);
  assert.equal(harness.byLabel('Putuskan tautan Telegram'), undefined);
  assert.equal(harness.byLabel('Hubungkan akun Telegram').props.disabled, false);
  assert.equal(harness.allByType('ActivityIndicator').length, 0);
});

test('Telegram unlink fallback errors preserve the link and restore enabled controls', async () => {
  const { harness, calls } = createSettingsHarness({
    user: { telegram_linked: true },
    behavior: { unlinkTelegram: async () => { throw new Error('network'); } },
  });
  await harness.mount();
  await press(harness, 'Putuskan tautan Telegram');
  await confirmation(calls).confirm.onPress();
  await harness.settle();

  assert.equal(calls.alerts.at(-1).title, 'Gagal memutus tautan');
  assert.equal(calls.alerts.at(-1).message, 'Coba lagi sebentar lagi.');
  assert.equal(calls.getProfile, 1);
  assert.equal(harness.byLabel('Putuskan tautan Telegram').props.disabled, false);
  assert.equal(harness.byLabel('Putuskan tautan Telegram').props.accessibilityState.busy, false);
  assert.equal(harness.byLabel('New Telegram link code').props.disabled, false);
});

test('a mutation reload without server error detail shows the fallback and never treats stale profile data as actionable', async () => {
  const { harness, behavior, calls } = createSettingsHarness({ user: { telegram_linked: true } });
  await harness.mount();
  behavior.getProfile = async () => { throw new Error('network'); };
  await press(harness, 'Putuskan tautan Telegram');
  await confirmation(calls).confirm.onPress();
  await harness.settle();

  assert.ok(harness.texts().includes('Gagal memuat profil.'));
  assert.ok(harness.texts().includes('Account details unavailable.'));
  assert.equal(calls.describedErrors.at(-1).fallback, 'Gagal memuat profil.');
  assertProfileActionsDisabled(harness);
  assert.equal(harness.byLabel('Putuskan tautan Telegram'), undefined);
  assert.equal(harness.byLabel('Coba lagi').props.disabled, false);

  behavior.getProfile = async () => profile();
  await retry(harness);
  assert.equal(calls.unlinkTelegram, 1);
  assert.equal(calls.getProfile, 3);
  assert.equal(harness.texts().includes('Gagal memuat profil.'), false);
  assert.equal(harness.byLabel('Hubungkan akun Telegram').props.disabled, false);
});

test('same-render Telegram presses and stale cross-account callbacks cannot duplicate a pending mutation', async () => {
  const pending = deferred();
  const { harness, calls } = createSettingsHarness({
    behavior: { createTelegramLinkToken: () => pending.promise },
  });
  await harness.mount();
  const generate = harness.byLabel('Hubungkan akun Telegram').props.onPress;
  const changePassword = harness.byLabel('Change password').props.onPress;
  const deleteAccount = harness.byLabel('Delete account').props.onPress;
  const linkGoogle = harness.byLabel('Tautkan akun Google').props.onPress;

  const result = generate();
  await generate();
  changePassword();
  deleteAccount();
  linkGoogle();
  harness.flush();
  assert.equal(calls.createTelegramLinkToken, 1);
  assert.deepEqual(calls.pushes, []);
  assert.deepEqual(calls.alerts, []);
  assert.equal(harness.byType('LinkGoogleSheet').props.visible, false);

  pending.resolve({ code: '123456', expires_in_minutes: 5 });
  await result;
  await harness.settle();
  assert.equal(calls.alerts.length, 1);
  assert.equal(harness.byLabel('Change password').props.disabled, false);
});

test('an open Google sheet blocks competing account actions until it closes', async () => {
  const { harness, calls } = createSettingsHarness();
  await harness.mount();
  const callbacks = ['Hubungkan akun Telegram', 'Change password', 'Delete account']
    .map((label) => harness.byLabel(label).props.onPress);
  await press(harness, 'Tautkan akun Google');

  for (const callback of callbacks) await callback();
  harness.flush();
  assertProfileActionsDisabled(harness);
  assert.equal(calls.createTelegramLinkToken, 0);
  assert.deepEqual(calls.pushes, []);
  assert.deepEqual(calls.alerts, []);

  harness.byType('LinkGoogleSheet').props.onClose();
  await harness.settle();
  assert.equal(harness.byLabel('Change password').props.disabled, false);
});

test('a rejected native Google availability check becomes an honest unavailable state', async () => {
  const { harness, calls } = createSettingsHarness({
    behavior: { googleAvailability: async () => { throw new Error('Native module missing.'); } },
  });
  await harness.mount();

  assert.equal(calls.googleAvailability, 1);
  assert.equal(harness.byLabel('Tautkan akun Google'), undefined);
  assert.ok(harness.texts().includes('Google sign-in is not available in this build.'));
  assert.equal(harness.texts().includes('Checking availability...'), false);
  assert.equal(harness.byType('LinkGoogleSheet').props.visible, false);
  assert.equal(harness.byLabel('Change password').props.disabled, false);
});

test('missing password capability does not advertise Google linking but retains password-management navigation', async () => {
  const { harness, calls } = createSettingsHarness({ user: { has_password: undefined } });
  await harness.mount();

  assert.equal(harness.byLabel('Tautkan akun Google'), undefined);
  assert.ok(harness.texts().includes('Google linking requires an account password.'));
  await press(harness, 'Change password');
  assert.deepEqual(calls.pushes, ['/change-password']);
});

test('returning from password management reloads capabilities while retaining current currency', async () => {
  const pending = deferred();
  const { harness, calls, behavior, blur, focus } = createSettingsHarness({
    user: { has_password: false, google_linked: true, currency: 'EUR' },
  });
  await harness.mount();
  await press(harness, 'Change password');
  blur();
  behavior.getProfile = () => pending.promise;
  await focus();

  assert.equal(calls.getProfile, 2);
  assert.ok(harness.texts().includes('EUR'));
  assert.ok(harness.texts().includes('Loading account details...'));
  assertProfileActionsDisabled(harness);

  pending.resolve(profile({ has_password: true, google_linked: true, currency: 'CHF' }));
  await harness.settle();
  assert.ok(harness.texts().includes('CHF'));
  assert.ok(harness.texts().includes('Google tertaut'));
  assert.match(harness.byLabel('Change password').props.accessibilityHint, /Update your password/);
  assert.equal(harness.byLabel('Change password').props.disabled, false);
  assert.deepEqual(calls.pushes, ['/change-password']);
});

for (const staleResult of ['success', 'failure']) {
  test(`an older focus ${staleResult} cannot overwrite a newer successful profile`, async () => {
    const older = deferred();
    const newer = deferred();
    const { harness, calls, behavior, focus } = createSettingsHarness({
      behavior: { getProfile: () => older.promise },
    });
    await harness.mount();
    behavior.getProfile = () => newer.promise;
    await focus();
    assert.equal(calls.getProfile, 2);

    newer.resolve(profile({ currency: 'CAD', telegram_linked: true }));
    await harness.settle();
    if (staleResult === 'success') older.resolve(profile({ currency: 'USD' }));
    else older.reject(apiError('Stale request failed.'));
    await harness.settle();

    assert.ok(harness.texts().includes('CAD'));
    assert.equal(harness.texts().includes('USD'), false);
    assert.equal(harness.texts().includes('Stale request failed.'), false);
    assert.equal(harness.byLabel('Coba lagi'), undefined);
    assert.equal(calls.describedErrors.length, 0);
    assert.equal(harness.byLabel('New Telegram link code').props.disabled, false);
  });
}

test('an older profile success cannot clear the newer focus error or enable account actions', async () => {
  const older = deferred();
  const newer = deferred();
  const { harness, behavior, focus } = createSettingsHarness({
    behavior: { getProfile: () => older.promise },
  });
  await harness.mount();
  behavior.getProfile = () => newer.promise;
  await focus();
  newer.reject(apiError('Current profile failed.'));
  await harness.settle();
  older.resolve(profile({ currency: 'USD' }));
  await harness.settle();

  assert.ok(harness.texts().includes('Current profile failed.'));
  assert.equal(harness.texts().includes('USD'), false);
  assert.ok(harness.byLabel('Coba lagi'));
  assertProfileActionsDisabled(harness);
});

test('blurred settings ignore a late profile response and stale profile-action callbacks', async () => {
  const pending = deferred();
  const { harness, calls, behavior, blur, focus } = createSettingsHarness();
  await harness.mount();
  const callbacks = ['Hubungkan akun Telegram', 'Tautkan akun Google', 'Change password', 'Delete account']
    .map((label) => harness.byLabel(label).props.onPress);
  const linked = harness.byType('LinkGoogleSheet').props.onLinked;
  behavior.getProfile = () => pending.promise;
  await focus();
  blur();

  for (const callback of callbacks) await callback();
  linked(profile({ google_linked: true, currency: 'GBP' }));
  pending.resolve(profile({ currency: 'USD' }));
  await harness.settle();

  assert.ok(harness.texts().includes('IDR'));
  assert.equal(harness.texts().includes('USD'), false);
  assert.equal(harness.texts().includes('GBP'), false);
  assert.equal(calls.createTelegramLinkToken, 0);
  assert.deepEqual(calls.pushes, []);
  assert.deepEqual(calls.alerts, []);
  assert.equal(harness.byType('LinkGoogleSheet').props.visible, false);
});

for (const transition of ['blur', 'unmount']) {
  test(`Telegram token completion after ${transition} cannot display a stale code`, async () => {
    const pending = deferred();
    const bundle = createSettingsHarness({ behavior: { createTelegramLinkToken: () => pending.promise } });
    const { harness, calls } = bundle;
    await harness.mount();
    const result = harness.byLabel('Hubungkan akun Telegram').props.onPress();
    harness.flush();
    if (transition === 'blur') bundle.blur();
    else harness.unmount();
    pending.resolve({ code: '123456', expires_in_minutes: 5 });
    await result;
    await harness.settle();

    assert.equal(calls.createTelegramLinkToken, 1);
    assert.deepEqual(calls.alerts, []);
    assert.deepEqual(calls.replacements, []);
  });

  test(`Putuskan tautan Telegram confirmation saved before ${transition} cannot mutate an inactive account`, async () => {
    const bundle = createSettingsHarness({ user: { telegram_linked: true } });
    const { harness, calls } = bundle;
    await harness.mount();
    await press(harness, 'Putuskan tautan Telegram');
    const confirm = confirmation(calls).confirm.onPress;
    if (transition === 'blur') bundle.blur();
    else harness.unmount();

    await confirm();
    await harness.settle();
    assert.equal(calls.unlinkTelegram, 0);
    assert.equal(calls.getProfile, 1);
    assert.deepEqual(calls.replacements, []);
  });
}

test('a Google linking callback wins over an in-flight focus refresh and closes the sheet', async () => {
  const pending = deferred();
  const { harness, behavior, focus, calls } = createSettingsHarness();
  await harness.mount();
  await press(harness, 'Tautkan akun Google');
  behavior.getProfile = () => pending.promise;
  await focus();
  assert.equal(calls.getProfile, 2);
  assert.equal(harness.byType('LinkGoogleSheet').props.visible, true);

  harness.byType('LinkGoogleSheet').props.onLinked(profile({
    google_linked: true, currency: 'GBP',
  }));
  await harness.settle();
  pending.resolve(profile({ google_linked: false, currency: 'USD' }));
  await harness.settle();

  assert.ok(harness.texts().includes('Google tertaut'));
  assert.ok(harness.texts().includes('GBP'));
  assert.equal(harness.texts().includes('USD'), false);
  assert.equal(harness.byLabel('Tautkan akun Google'), undefined);
  assert.equal(harness.byLabel('Change password').props.disabled, false);
  assert.equal(harness.byType('LinkGoogleSheet').props.visible, false);
});

test('unmounted settings ignore an initial profile failure without surfacing an obsolete error', async () => {
  const pending = deferred();
  const { harness, calls } = createSettingsHarness({ behavior: { getProfile: () => pending.promise } });
  await harness.mount();
  harness.unmount();
  pending.reject(apiError('Obsolete profile failure.'));
  await harness.settle();

  assert.equal(calls.getProfile, 1);
  assert.deepEqual(calls.describedErrors, []);
  assert.equal(harness.texts().includes('Obsolete profile failure.'), false);
  assert.deepEqual(calls.alerts, []);
});

test('Preferences & app exposes Light and Dark theme options and switches immediately', async () => {
  const { harness, calls } = createSettingsHarness();
  await harness.mount();

  const preferences = sectionFor(harness, 'Preferences & app');
  const lightBtn = harness.byLabel('Tema Light');
  const darkBtn = harness.byLabel('Tema Dark');
  assert.ok(contains(preferences, lightBtn));
  assert.ok(contains(preferences, darkBtn));
  assert.equal(lightBtn.props.accessibilityState.checked, true);
  assert.equal(darkBtn.props.accessibilityState.checked, false);
  assert.ok(harness.texts().includes('Mode terang aktif'));
  assert.equal(flattenStyle(darkBtn.props.style({ pressed: false })).backgroundColor, '#FBFAF5');

  await press(harness, 'Tema Dark');
  assert.deepEqual(calls.themeModes, ['dark']);
  assert.equal(harness.byLabel('Tema Light').props.accessibilityState.checked, false);
  assert.equal(harness.byLabel('Tema Dark').props.accessibilityState.checked, true);
  assert.ok(harness.texts().includes('Mode gelap aktif'));
  assert.equal(flattenStyle(harness.byLabel('Tema Dark').props.style({ pressed: false })).backgroundColor, '#F2EFE6');

  await press(harness, 'Tema Light');
  assert.deepEqual(calls.themeModes, ['dark', 'light']);
  assert.equal(harness.byLabel('Tema Light').props.accessibilityState.checked, true);
  assert.ok(harness.texts().includes('Mode terang aktif'));
});

test('theme toggle works while profile is loading or failed', async () => {
  const { harness, calls } = createSettingsHarness({
    dimensions: { width: 359 },
    behavior: { getProfile: async () => { throw new Error('offline'); } },
  });
  await harness.mount();

  await press(harness, 'Tema Dark');
  assert.deepEqual(calls.themeModes, ['dark']);
  assert.equal(harness.byLabel('Tema Dark').props.accessibilityState.checked, true);
});
