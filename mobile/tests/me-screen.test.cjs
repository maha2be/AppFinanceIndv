/**
 * Runtime regressions for the "Saya" tab (`app/(tabs)/me.tsx`) and tab/stack
 * navigation wiring.
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

function createMeHarness(options = {}) {
  let focusCallback;
  let focusCleanup;
  const calls = {
    getProfile: 0,
    logout: 0,
    alerts: [],
    pushes: [],
    replacements: [],
    describedErrors: [],
  };
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
    logout: async () => {},
    ...options.behavior,
  };
  const authApi = {};
  for (const method of ['getProfile', 'logout']) {
    authApi[method] = (...args) => {
      calls[method] += 1;
      return behavior[method](...args);
    };
  }
  const themeMode = options.themeMode || 'light';

  const harness = createHarness({
    componentPath: 'app/(tabs)/me.tsx',
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
          push: (route) => calls.pushes.push(route),
          replace: (route) => calls.replacements.push(route),
        },
      },
      'react-native': { Image: stub('Image') },
      '../../utils/theme': {
        Colors: tokenProxy(),
        Fonts: tokenProxy(),
        Radius: tokenProxy(),
        Space: tokenProxy(),
        Type: tokenProxy(),
      },
      '../../components/ui/Screen': { Screen: stub('Screen') },
      '../../components/ui/FadeIn': { FadeIn: stub('FadeIn') },
      '../../components/ui/Skeleton': { Skeleton: stub('Skeleton') },
      '../../components/profile/EditProfileSheet': { EditProfileSheet: stub('EditProfileSheet') },
      '../../services/appAlert': {
        AppAlert: {
          alert: (title, message, buttons) => calls.alerts.push({ title, message, buttons }),
        },
      },
      '../../services/auth': {
        authApi,
        describeApiError: (error, fallback) => {
          calls.describedErrors.push({ error, fallback });
          return error?.response?.data?.detail || fallback;
        },
      },
      '../../services/appLock': {
        getAppLockState: () => lockState,
        subscribeAppLock: () => () => {},
      },
      '../../services/theme': {
        useTheme: () => ({
          mode: themeMode,
          isDark: themeMode === 'dark',
          colors: tokenProxy(),
          type: tokenProxy(),
          shadow: tokenProxy(),
          setThemeMode: async () => {},
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
  return { harness, calls, behavior, lockState, blur, focus };
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

test('tab bar exposes Saya instead of Pengaturan', async () => {
  const Tabs = (props) => node('Tabs', props);
  Tabs.Screen = (props) => node('Tabs.Screen', props);
  const harness = createHarness({
    componentPath: 'app/(tabs)/_layout.tsx',
    modules: {
      'expo-router': { Tabs },
      'react-native': { Platform: { OS: 'android' } },
      'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
    },
  });
  await harness.mount();

  const screens = harness.allByType('Tabs.Screen').map((item) => ({
    name: item.props.name,
    title: item.props.options?.title,
  }));
  assert.deepEqual(screens, [
    { name: 'index', title: 'Beranda' },
    { name: 'add', title: 'Catat' },
    { name: 'reports', title: 'Laporan' },
    { name: 'me', title: 'Saya' },
  ]);
});

test('profile loading shows placeholders until the requested account arrives', async () => {
  const pending = deferred();
  const { harness, calls } = createMeHarness({
    behavior: { getProfile: () => pending.promise },
  });
  await harness.mount();

  assert.equal(calls.getProfile, 1);
  assert.ok(harness.allByType('Skeleton').length > 0);
  assert.equal(harness.textMatching(/ayu@example/), undefined);
  assert.equal(harness.byLabel('Coba lagi'), undefined);
  assert.ok(harness.texts().includes('Loading account details...'));

  pending.resolve(profile({ first_name: 'Élodie 李' }));
  await harness.settle();

  assert.ok(harness.texts().includes('Élodie 李'));
  assert.ok(harness.texts().includes('ayu@example.test'));
  assert.equal(harness.allByType('Skeleton').length, 0);
  assert.equal(harness.texts().includes('Loading account details...'), false);
});

test('empty optional profile fields retain safe display fallbacks', async () => {
  const { harness } = createMeHarness({
    user: { first_name: '', email: null },
  });
  await harness.mount();

  assert.ok(harness.texts().includes('Pengguna'));
  assert.equal(harness.textMatching(/undefined|null/), undefined);
});

test('profile dependency failure shows its error and retry loads the account', async () => {
  const failure = apiError('Profile temporarily unavailable.');
  const { harness, calls, behavior } = createMeHarness({
    behavior: { getProfile: async () => { throw failure; } },
  });
  await harness.mount();

  assert.ok(harness.texts().includes('Profile temporarily unavailable.'));
  assert.ok(harness.texts().includes('Account details unavailable.'));
  assert.equal(harness.byLabel('Coba lagi').props.disabled, false);
  assert.equal(calls.describedErrors[0].error, failure);

  behavior.getProfile = async () => profile({ first_name: 'Recovered account' });
  await press(harness, 'Coba lagi');

  assert.equal(calls.getProfile, 2);
  assert.equal(harness.byLabel('Coba lagi'), undefined);
  assert.ok(harness.texts().includes('Recovered account'));
});

for (const [label, route] of [
  ['Transaksi berulang', '/recurring'],
  ['Hutang & piutang', '/debts'],
  ['Daftar belanja', '/shopping-lists'],
  ['Riwayat perubahan', '/transaction-history'],
  ['Pengaturan', '/settings'],
]) {
  test(`${label} opens ${route} without logging out`, async () => {
    const { harness, calls } = createMeHarness();
    await harness.mount();

    await press(harness, label);
    assert.deepEqual(calls.pushes, [route]);
    assert.deepEqual(calls.replacements, []);
    assert.equal(calls.logout, 0);
  });
}

test('Saya organizes personal finance features, Pengaturan, and Keluar cleanly', async () => {
  const { harness } = createMeHarness({
    themeMode: 'dark',
    lockState: { enabled: true },
  });
  await harness.mount();

  const features = sectionFor(harness, 'Fitur keuangan');
  const appSection = sectionFor(harness, 'Akun & aplikasi');
  const elements = harness.elements();

  assert.ok(elements.indexOf(features) < elements.indexOf(appSection));
  assert.ok(contains(features, harness.byLabel('Transaksi berulang')));
  assert.ok(contains(features, harness.byLabel('Hutang & piutang')));
  assert.ok(contains(features, harness.byLabel('Riwayat perubahan')));
  assert.ok(contains(appSection, harness.byLabel('Pengaturan')));
  assert.match(
    textWithin(harness.byLabel('Pengaturan')).join(' '),
    /Kunci aktif · Tema Dark · Akun terhubung/
  );
  assert.ok(
    elements.indexOf(harness.byLabel('Keluar dari akun')) >
    elements.indexOf(harness.byLabel('Pengaturan'))
  );
  assert.equal(harness.byLabel('Delete account'), undefined);
});

test('logout cancellation keeps the current session and does not navigate', async () => {
  const { harness, calls } = createMeHarness();
  await harness.mount();

  await press(harness, 'Keluar dari akun');
  await confirmation(calls).cancel.onPress?.();

  assert.equal(calls.logout, 0);
  assert.deepEqual(calls.replacements, []);
  assert.deepEqual(calls.pushes, []);
});

test('confirmed logout waits for session cleanup before replacing the login route', async () => {
  const pending = deferred();
  const { harness, calls } = createMeHarness({
    behavior: { logout: () => pending.promise },
  });
  await harness.mount();
  await press(harness, 'Keluar dari akun');

  assert.equal(calls.logout, 0);
  const result = confirmation(calls).confirm.onPress();
  assert.equal(calls.logout, 1);
  assert.deepEqual(calls.replacements, []);

  pending.resolve();
  await result;
  await harness.settle();

  assert.deepEqual(calls.replacements, ['/(auth)/login']);
  assert.deepEqual(calls.pushes, []);
});

test('failed session cleanup never replaces the screen and restores controls after reload', async () => {
  const failure = new Error('Session cleanup failed.');
  const { harness, calls } = createMeHarness({
    behavior: { logout: async () => { throw failure; } },
  });
  await harness.mount();
  await press(harness, 'Keluar dari akun');

  await confirmation(calls).confirm.onPress();
  await harness.settle();

  assert.equal(calls.logout, 1);
  assert.deepEqual(calls.replacements, []);
  assert.equal(calls.alerts.at(-1).title, 'Unable to sign out');
  assert.equal(calls.getProfile, 2);
  assert.equal(harness.byLabel('Keluar dari akun').props.accessibilityState.busy, false);
  assert.equal(harness.byLabel('Pengaturan').props.disabled, false);
});

for (const transition of ['blur', 'unmount']) {
  test(`Keluar dari akun confirmation saved before ${transition} cannot log out an inactive screen`, async () => {
    const bundle = createMeHarness();
    const { harness, calls } = bundle;
    await harness.mount();
    await press(harness, 'Keluar dari akun');
    const confirm = confirmation(calls).confirm.onPress;
    if (transition === 'blur') bundle.blur();
    else harness.unmount();

    await confirm();
    await harness.settle();
    assert.equal(calls.logout, 0);
    assert.deepEqual(calls.replacements, []);
  });
}

test('long account name and email remain eligible to wrap without truncation', async () => {
  const name = 'Élodie 李 with a long account name';
  const email = 'long-account-name@example.test';
  const { harness } = createMeHarness({ user: { first_name: name, email } });
  await harness.mount();

  for (const text of [name, email]) {
    const element = harness.allByType('Text').find((el) => textWithin(el).includes(text));
    assert.ok(element);
    assert.equal(element.props.numberOfLines, undefined);
  }
});

test('Edit profil opens EditProfileSheet, blocks competing actions, and updates profile on save', async () => {
  const { harness, calls } = createMeHarness();
  await harness.mount();

  assert.equal(harness.byType('EditProfileSheet').props.visible, false);
  await press(harness, 'Edit profil');
  assert.equal(harness.byType('EditProfileSheet').props.visible, true);
  assert.equal(harness.byLabel('Pengaturan').props.disabled, true);
  assert.equal(harness.byLabel('Keluar dari akun').props.disabled, true);

  const avatar = 'data:image/jpeg;base64,/9j/4AAQ';
  harness.byType('EditProfileSheet').props.onSaved(
    profile({ first_name: 'Ayu Baru', avatar_url: avatar })
  );
  await harness.settle();

  assert.equal(harness.byType('EditProfileSheet').props.visible, false);
  assert.ok(harness.texts().includes('Ayu Baru'));
  assert.equal(harness.byType('Image').props.source.uri, avatar);
  assert.equal(harness.byLabel('Pengaturan').props.disabled, false);
  assert.equal(calls.getProfile, 1);
});

test('Edit profil is unavailable before profile loads and disabled when profile reload fails', async () => {
  const pending = deferred();
  const { harness, behavior, focus } = createMeHarness({
    behavior: { getProfile: () => pending.promise },
  });
  await harness.mount();

  assert.equal(harness.byLabel('Edit profil'), undefined);
  pending.resolve(profile());
  await harness.settle();
  assert.equal(harness.byLabel('Edit profil').props.disabled, false);

  behavior.getProfile = async () => { throw new Error('offline'); };
  await focus();
  assert.equal(harness.byLabel('Edit profil').props.disabled, true);
});
