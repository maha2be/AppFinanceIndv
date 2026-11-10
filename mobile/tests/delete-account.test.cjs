/**
 * Runtime tests for the delete-account screen proof routing.
 *
 * The screen is mounted with the shared mini renderer and every side effect is
 * a deterministic spy: no network, session storage, Google SDK, or native lock
 * service is touched.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createHarness, loadTsModule, mobileRoot } = require('./support/screen-harness.cjs');

const PASSWORD = 'correct horse battery staple';
const DELETE_LABEL = 'I understand that all of my financial records and account data will be permanently deleted.';

const accountDeletion = loadTsModule(
  path.join(mobileRoot, 'utils/accountDeletion.ts'),
  (name) => { throw new Error(`Unexpected module in account deletion helper: ${name}`); },
);
const googleError = loadTsModule(
  path.join(mobileRoot, 'utils/googleError.ts'),
  (name) => { throw new Error(`Unexpected module in Google error helper: ${name}`); },
);
const authService = loadTsModule(
  path.join(mobileRoot, 'services/auth.ts'),
  (name) => {
    if (name === 'axios') return { default: { create: () => ({}) } };
    return {};
  },
);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function normalized(value) {
  return JSON.parse(JSON.stringify(value));
}

function createDeleteHarness(options = {}) {
  const user = options.user ?? {
    id: 1,
    timezone: 'Asia/Jakarta',
    currency: 'IDR',
    has_password: true,
    google_linked: false,
  };

  const calls = [];
  const googleCalls = [];
  const sessionListeners = new Set();
  const lockState = { ready: true, locked: false, covered: false };
  const lockListeners = new Set();
  let authenticated = true;
  let promptActive = false;
  let deleteImpl = async () => {};
  let idTokenImpl = async () => 'google-id-token';
  let availability = true;

  function waitForGate() {
    if (authenticated && lockState.ready && !lockState.locked && !lockState.covered) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        lockListeners.delete(check);
        sessionListeners.delete(check);
      };
      const check = () => {
        if (!authenticated) {
          cleanup();
          reject(new Error('Sesi berubah. Konfirmasi akun kembali.'));
        } else if (lockState.ready && !lockState.locked && !lockState.covered) {
          cleanup();
          resolve();
        }
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Verifikasi kedaluwarsa. Konfirmasi akun kembali.'));
      }, 60_000);
      lockListeners.add(check);
      sessionListeners.add(check);
      check();
    });
  }

  const authApi = {
    getProfile: async () => user,
    deleteAccount: async (params) => {
      calls.push({ kind: 'delete', params });
      return deleteImpl(params);
    },
  };

  const google = {
    isGoogleAuthAvailable: async () => {
      googleCalls.push('availability');
      return availability;
    },
    signOutGoogle: async () => { googleCalls.push('signOut'); },
    requestGoogleIdToken: async () => {
      googleCalls.push('idToken');
      return idTokenImpl();
    },
  };

  const router = {
    replaced: [],
    backCalls: 0,
    replace(route) { this.replaced.push(route); },
    back() { this.backCalls += 1; },
    push() {},
  };

  const harness = createHarness({
    componentPath: 'app/delete-account.tsx',
    modules: {
      'expo-router': { router },
      '../services/auth': {
        authApi,
        describeApiError: authService.describeApiError,
      },
      '../services/googleAuth': google,
      '../utils/googleError': googleError,
      '../utils/accountDeletion': accountDeletion,
      '../services/appLock': {
        getAppLockState: () => lockState,
        subscribeAppLock: (listener) => {
          lockListeners.add(listener);
          return () => lockListeners.delete(listener);
        },
        withAppLockCredentialPrompt: async (prompt) => {
          if (!authenticated || !lockState.ready || lockState.locked || lockState.covered) {
            throw new Error('Buka kunci aplikasi sebelum memverifikasi akun.');
          }
          promptActive = true;
          try {
            const result = await prompt();
            await waitForGate();
            return result;
          } finally {
            promptActive = false;
          }
        },
      },
      '../services/session': {
        isAuthenticated: () => authenticated,
        subscribeSession: (listener) => {
          sessionListeners.add(listener);
          return () => sessionListeners.delete(listener);
        },
      },
    },
  });

  return Object.assign(harness, {
    harness,
    calls,
    googleCalls,
    router,
    lockState,
    setAuthenticated(value) { authenticated = value; },
    setLocked(value) { lockState.locked = value; },
    setCovered(value) { lockState.covered = value; },
    emitLock() { for (const listener of lockListeners) listener(); },
    isPromptActive: () => promptActive,
    sessionListeners,
    setAvailability(value) { availability = value; },
    setIdToken(fn) { idTokenImpl = fn; },
    setDeleteImpl(fn) { deleteImpl = fn; },
  });
}

async function fillConfirmation(harness) {
  harness.change('Type DELETE to confirm', 'DELETE');
  await harness.press(DELETE_LABEL);
}

function submitButton(harness, title) {
  return harness.byLabel(title);
}

test('a legacy profile without capability flags asks for the password and never touches Google', async () => {
  const { harness, calls, googleCalls, router } = createDeleteHarness({
    user: { id: 1, timezone: 'Asia/Jakarta', currency: 'IDR', google_linked: true },
  });
  await harness.mount();

  assert.ok(harness.byLabel('Account password'), 'legacy profiles must show password proof');
  assert.equal(harness.byLabel('Verify with Google and delete account'), undefined);

  harness.change('Account password', PASSWORD);
  await fillConfirmation(harness);
  await harness.press('Permanently delete account');

  assert.deepEqual(normalized(calls), [{ kind: 'delete', params: { confirmation: 'DELETE', password: PASSWORD } }]);
  assert.deepEqual(googleCalls, [], 'a password deletion must not call Google at all');
  assert.deepEqual(router.replaced, ['/(auth)/login']);
});

test('a password profile with linked Google still deletes with the password', async () => {
  const { harness, calls, googleCalls } = createDeleteHarness({
    user: {
      id: 1,
      timezone: 'Asia/Jakarta',
      currency: 'IDR',
      has_password: true,
      google_linked: true,
    },
  });
  await harness.mount();

  harness.change('Account password', PASSWORD);
  await fillConfirmation(harness);
  await harness.press('Permanently delete account');

  assert.deepEqual(normalized(calls[0].params), { confirmation: 'DELETE', password: PASSWORD });
  assert.deepEqual(googleCalls, []);
});

test('an explicit Google-only profile verifies with Google and sends the ID token', async () => {
  const { harness, calls, googleCalls, router } = createDeleteHarness({
    user: {
      id: 1,
      timezone: 'Asia/Jakarta',
      currency: 'IDR',
      has_password: false,
      google_linked: true,
    },
  });
  await harness.mount();

  assert.equal(harness.byLabel('Account password'), undefined);
  assert.ok(harness.textMatching(/Google verification required/));

  await fillConfirmation(harness);
  await harness.press('Verify with Google and delete account');

  assert.equal(googleCalls[0], 'availability');
  assert.deepEqual(googleCalls, ['availability', 'signOut', 'idToken']);
  assert.deepEqual(normalized(calls), [{ kind: 'delete', params: { confirmation: 'DELETE', id_token: 'google-id-token' } }]);
  assert.deepEqual(router.replaced, ['/(auth)/login']);
});

test('cancelling the Google prompt deletes nothing and keeps the screen open', async () => {
  const { harness, calls, router } = createDeleteHarness({
    user: { id: 1, timezone: 'Asia/Jakarta', currency: 'IDR', has_password: false, google_linked: true },
  });
  harness.setIdToken(async () => null);
  await harness.mount();
  await fillConfirmation(harness);
  await harness.press('Verify with Google and delete account');

  assert.deepEqual(normalized(calls), []);
  assert.deepEqual(router.replaced, []);
  assert.ok(harness.byLabel('Verify with Google and delete account'));
});

test('unavailable native Google reports an error and never deletes', async () => {
  const { harness, calls, router } = createDeleteHarness({
    user: { id: 1, timezone: 'Asia/Jakarta', currency: 'IDR', has_password: false, google_linked: true },
  });
  harness.setAvailability(false);
  await harness.mount();
  await fillConfirmation(harness);
  await harness.press('Verify with Google and delete account');

  assert.deepEqual(normalized(calls), []);
  assert.deepEqual(router.replaced, []);
  assert.ok(harness.textMatching(/Login Google tidak tersedia/));
  assert.ok(harness.byLabel('Verify with Google and delete account'), 'the screen stays usable');
});

test('duplicate presses at the Google stage submit only once', async () => {
  const { harness, calls } = createDeleteHarness({
    user: { id: 1, timezone: 'Asia/Jakarta', currency: 'IDR', has_password: false, google_linked: true },
  });
  const token = deferred();
  harness.setIdToken(() => token.promise);
  await harness.mount();
  await fillConfirmation(harness);

  const button = submitButton(harness, 'Verify with Google and delete account');
  const first = button.props.onPress();
  const second = submitButton(harness, 'Verify with Google and delete account').props.onPress();
  token.resolve('one-token');
  await first;
  await second;
  await harness.settle();

  assert.deepEqual(normalized(calls), [{ kind: 'delete', params: { confirmation: 'DELETE', id_token: 'one-token' } }]);
});

test('an Android background holds the Google proof until the app lock is unlocked', async () => {
  const { harness, calls, setCovered, setLocked, emitLock } = createDeleteHarness({
    user: { id: 1, timezone: 'Asia/Jakarta', currency: 'IDR', has_password: false, google_linked: true },
  });
  const token = deferred();
  harness.setIdToken(() => token.promise);
  await harness.mount();
  await fillConfirmation(harness);

  const pending = submitButton(harness, 'Verify with Google and delete account').props.onPress();
  await harness.settle();
  assert.equal(harness.isPromptActive(), true);

  harness.appState.emit('background');
  setCovered(true);
  setLocked(true);
  emitLock();
  harness.flush();
  token.resolve('held-token');
  await harness.settle();

  assert.deepEqual(normalized(calls), [], 'a locked app must not complete deletion');
  assert.equal(harness.isPromptActive(), true, 'the proof stays pending while locked');

  harness.appState.emit('active');
  setCovered(false);
  emitLock();
  harness.flush();
  await harness.settle();
  assert.deepEqual(normalized(calls), [], 'returning active must not bypass the lock gate');

  setLocked(false);
  emitLock();
  await pending;
  await harness.settle();

  assert.deepEqual(normalized(calls), [{ kind: 'delete', params: { confirmation: 'DELETE', id_token: 'held-token' } }]);
});

test('logging out during Google verification rejects the proof and deletes nothing', async () => {
  const { harness, calls, setAuthenticated, sessionListeners } = createDeleteHarness({
    user: { id: 1, timezone: 'Asia/Jakarta', currency: 'IDR', has_password: false, google_linked: true },
  });
  const token = deferred();
  harness.setIdToken(() => token.promise);
  await harness.mount();
  await fillConfirmation(harness);

  const pending = submitButton(harness, 'Verify with Google and delete account').props.onPress();
  setAuthenticated(false);
  for (const listener of sessionListeners) listener();
  harness.flush();
  token.resolve('stale-token');
  await pending;
  await harness.settle();

  assert.deepEqual(normalized(calls), [], 'a stale session must not complete deletion');
  assert.equal(harness.isPromptActive(), false, 'the prompt lease is released');
});

test('a no-lock installation resumes Google verification after background and active', async () => {
  const { harness, calls, googleCalls, router, setCovered, emitLock } = createDeleteHarness({
    user: { id: 1, timezone: 'Asia/Jakarta', currency: 'IDR', has_password: false, google_linked: true },
  });
  const token = deferred();
  harness.setIdToken(() => token.promise);
  await harness.mount();
  await fillConfirmation(harness);

  const pending = submitButton(harness, 'Verify with Google and delete account').props.onPress();
  await harness.settle();
  assert.ok(googleCalls.includes('idToken'), 'the native prompt must be in flight');
  assert.equal(harness.isPromptActive(), true);

  harness.appState.emit('background');
  setCovered(true);
  emitLock();
  harness.flush();
  token.resolve('native-token');
  await harness.settle();
  assert.equal(harness.isPromptActive(), true, 'the proof waits for the app to return');
  assert.deepEqual(normalized(calls), []);

  harness.appState.emit('active');
  setCovered(false);
  emitLock();
  await pending;
  await harness.settle();

  assert.deepEqual(normalized(calls), [{ kind: 'delete', params: { confirmation: 'DELETE', id_token: 'native-token' } }]);
  assert.deepEqual(router.replaced, ['/(auth)/login']);
});

test('the covered sheet state does not invalidate an in-flight Google proof', async () => {
  const { harness, calls, router, setCovered, emitLock } = createDeleteHarness({
    user: { id: 1, timezone: 'Asia/Jakarta', currency: 'IDR', has_password: false, google_linked: true },
  });
  const token = deferred();
  harness.setIdToken(() => token.promise);
  await harness.mount();
  await fillConfirmation(harness);

  const pending = submitButton(harness, 'Verify with Google and delete account').props.onPress();
  await harness.settle();
  assert.equal(harness.isPromptActive(), true);

  setCovered(true);
  emitLock();
  setCovered(false);
  emitLock();
  token.resolve('covered-token');
  await pending;
  await harness.settle();

  assert.deepEqual(normalized(calls), [{ kind: 'delete', params: { confirmation: 'DELETE', id_token: 'covered-token' } }]);
  assert.deepEqual(router.replaced, ['/(auth)/login']);
});

test('a locked device rejects the Google-only deletion before any proof request', async () => {
  const { harness, calls, googleCalls, setLocked } = createDeleteHarness({
    user: { id: 1, timezone: 'Asia/Jakarta', currency: 'IDR', has_password: false, google_linked: true },
  });
  await harness.mount();
  await fillConfirmation(harness);
  setLocked(true);

  await harness.press('Verify with Google and delete account');

  assert.deepEqual(googleCalls, [], 'a locked device must not start Google verification');
  assert.deepEqual(normalized(calls), []);
});

test('a backend failure clears the password, reports it, and keeps the session', async () => {
  const { harness, calls, router } = createDeleteHarness();
  harness.setDeleteImpl(async () => {
    const error = new Error('rejected');
    error.response = { status: 401, data: { detail: 'Password is incorrect.' } };
    throw error;
  });
  await harness.mount();
  harness.change('Account password', PASSWORD);
  await fillConfirmation(harness);
  await harness.press('Permanently delete account');

  assert.equal(calls.length, 1);
  assert.deepEqual(router.replaced, []);
  assert.ok(harness.textMatching(/Password is incorrect\./));
  assert.equal(harness.byLabel('Account password').props.value, '', 'failed proof clears the password');
  assert.ok(harness.byLabel('Permanently delete account'), 'the user can retry');
});

test('confirmation text and acknowledgement are enforced before any proof request', async () => {
  const { harness, calls, googleCalls } = createDeleteHarness({
    user: { id: 1, timezone: 'Asia/Jakarta', currency: 'IDR', has_password: false, google_linked: true },
  });
  await harness.mount();

  await harness.press('Verify with Google and delete account');
  assert.deepEqual(googleCalls, []);
  assert.ok(harness.textMatching(/Type DELETE in uppercase/));

  harness.change('Type DELETE to confirm', 'DELETE');
  await harness.press('Verify with Google and delete account');
  assert.deepEqual(googleCalls, []);
  assert.ok(harness.textMatching(/permanent/));

  await harness.press(DELETE_LABEL);
  await harness.press('Verify with Google and delete account');
  assert.equal(googleCalls.length, 3);
  assert.equal(calls.length, 1);
});