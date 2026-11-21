/**
 * Unit, lifecycle, and overlay UI tests for the post-login / new-user tutorial hint.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createHarness, loadTsModule, mobileRoot, tokenProxy } = require('./support/screen-harness.cjs');

function node(type, props = {}) {
  const children = props.children === undefined ? [] : [props.children].flat(Infinity);
  return { type, props, children };
}

const stub = (type) => (props = {}) => node(type, props);

function loadTutorialStore() {
  const steps = loadTsModule(
    path.join(mobileRoot, 'utils/tutorialSteps.ts'),
    (name) => {
      throw new Error(`Unexpected import in tutorialSteps.ts: ${name}`);
    }
  );
  const store = loadTsModule(
    path.join(mobileRoot, 'services/tutorialHint.ts'),
    (name) => {
      if (name === '../utils/tutorialSteps') return steps;
      throw new Error(`Unexpected import in tutorialHint.ts: ${name}`);
    }
  );
  return { steps, store };
}

test('tutorialHint starts inactive on cold open and activates only after sign-in or manual guide', () => {
  const { steps, store } = loadTutorialStore();
  assert.deepEqual(JSON.parse(JSON.stringify(store.getTutorialHintState())), {
    visible: false,
    pendingAfterUnlock: false,
    stepIndex: 0,
    trigger: 'login',
  });

  // Calling activatePendingTutorial on cold start (without login/register) is a no-op.
  store.activatePendingTutorial();
  assert.equal(store.getTutorialHintState().visible, false);

  // Explicit registration queues the tutorial and activates once inside unlocked tabs.
  store.queueTutorialOnSignIn('register');
  assert.equal(store.getTutorialHintState().visible, false);
  assert.equal(store.getTutorialHintState().pendingAfterUnlock, true);
  assert.equal(store.getTutorialHintState().trigger, 'register');

  store.activatePendingTutorial();
  assert.equal(store.getTutorialHintState().visible, true);
  assert.equal(store.getTutorialHintState().pendingAfterUnlock, false);
  assert.equal(store.getTutorialHintState().stepIndex, 0);

  // Step forward, back, jump, and complete past final step.
  store.nextTutorialStep();
  assert.equal(store.getTutorialHintState().stepIndex, 1);
  store.prevTutorialStep();
  assert.equal(store.getTutorialHintState().stepIndex, 0);
  store.goToTutorialStep(steps.TUTORIAL_STEPS.length - 1);
  assert.equal(store.getTutorialHintState().stepIndex, steps.TUTORIAL_STEPS.length - 1);
  store.nextTutorialStep();
  assert.equal(store.getTutorialHintState().visible, false);

  // Manual guide opens immediately without pending state.
  store.openTutorialGuide();
  assert.equal(store.getTutorialHintState().visible, true);
  assert.equal(store.getTutorialHintState().trigger, 'manual');

  store.resetTutorialHint();
  assert.equal(store.getTutorialHintState().visible, false);
  assert.equal(store.getTutorialHintState().pendingAfterUnlock, false);
});

test('tutorial queuing is wired only to register, login, and Google login (never cold start or password change)', () => {
  const authSource = fs.readFileSync(path.join(mobileRoot, 'services/auth.ts'), 'utf8');
  const sessionSource = fs.readFileSync(path.join(mobileRoot, 'services/session.ts'), 'utf8');

  assert.doesNotMatch(sessionSource, /tutorialHint|queueTutorialOnSignIn/);

  const registerBlock = authSource.slice(authSource.indexOf('async register('), authSource.indexOf('async login('));
  const loginBlock = authSource.slice(authSource.indexOf('async login('), authSource.indexOf('async getProfile('));
  const googleBlock = authSource.slice(authSource.indexOf('async googleLogin('), authSource.indexOf('async linkGoogle('));
  const changePasswordBlock = authSource.slice(authSource.indexOf('async changePassword('), authSource.indexOf('async forgotPassword('));

  assert.match(registerBlock, /queueTutorialOnSignIn\?\.\('register'\)/);
  assert.match(loginBlock, /queueTutorialOnSignIn\?\.\('login'\)/);
  assert.match(googleBlock, /queueTutorialOnSignIn\?\.\('login'\)/);
  assert.doesNotMatch(changePasswordBlock, /queueTutorialOnSignIn/);
});

test('TutorialHintOverlay gates behind AppLock, walks all steps with tab spotlight, and returns to Beranda', async () => {
  const { steps, store } = loadTutorialStore();
  const navigated = [];
  const backListeners = [];

  const harness = createHarness({
    componentPath: 'components/tutorial/TutorialHintOverlay.tsx',
    exportName: 'TutorialHintOverlay',
    props: {
      authed: true,
      gated: true,
      inAuthGroup: false,
      onNavigateTab: (route) => navigated.push(route),
    },
    modules: {
      'react-native': {
        ScrollView: stub('ScrollView'),
        Platform: { OS: 'android' },
        StyleSheet: {
          create: (styles) => styles,
          absoluteFill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
        },
        Animated: {
          View: 'Animated.View',
          Value: class {
            constructor(v) { this.value = v; }
            setValue(v) { this.value = v; }
            interpolate() { return 0; }
          },
          timing: () => ({ start: () => {} }),
        },
        BackHandler: {
          addEventListener: (_event, cb) => {
            backListeners.push(cb);
            return {
              remove: () => {
                const idx = backListeners.indexOf(cb);
                if (idx >= 0) backListeners.splice(idx, 1);
              },
            };
          },
        },
      },
      'react-native-safe-area-context': {
        useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }),
      },
      '../../utils/theme': {
        Colors: tokenProxy(),
        Fonts: tokenProxy(),
        Motion: { fast: 120, base: 180, slow: 260 },
        Radius: tokenProxy(),
        Space: tokenProxy(),
        Type: tokenProxy(),
      },
      '../../utils/motion': { useReducedMotion: () => true },
      '../../utils/tutorialSteps': steps,
      '../../services/tutorialHint': store,
      '../../services/theme': {
        useTheme: () => ({
          mode: 'light',
          isDark: false,
          colors: tokenProxy(),
          type: tokenProxy(),
          shadow: { sheet: {} },
          setThemeMode: async () => {},
        }),
        createThemedStyles: (factory) => (theme) => factory(theme),
      },
      '../ui/Button': {
        Button: (props) =>
          node('Pressable', {
            ...props,
            accessibilityRole: 'button',
            accessibilityLabel: props.title,
            disabled: Boolean(props.disabled || props.loading),
          }),
      },
    },
  });

  // Queue and activate tutorial, but while gated=true overlay must NOT render.
  store.queueTutorialOnSignIn('register');
  store.activatePendingTutorial();
  await harness.mount();
  assert.equal(harness.texts().length, 0);
  assert.deepEqual(navigated, []);

  // Unlock app -> Step 1 appears with personalized welcome title & navigates to Beranda.
  harness.update({ authed: true, gated: false, inAuthGroup: false, onNavigateTab: (r) => navigated.push(r) });
  await harness.settle();
  assert.ok(harness.texts().includes('Selamat datang di Bot04'));
  assert.ok(harness.texts().includes('1 / 5 · Beranda'));
  assert.deepEqual(navigated, ['/(tabs)']);

  // Advance to Step 2 (quick input examples + tab Catat).
  await harness.press('Lanjut');
  assert.ok(harness.texts().includes('Catat transaksi secepat mengetik'));
  assert.ok(harness.texts().includes('"crypto xrp 150000"'));
  assert.equal(navigated.at(-1), '/(tabs)/add');

  // Jump via spotlight bar directly to Laporan (Step 3).
  await harness.press('Lihat panduan tab Laporan');
  assert.ok(harness.texts().includes('Grafik stabilitas & rincian kategori'));
  assert.equal(navigated.at(-1), '/(tabs)/reports');

  // Hardware back steps backward to Step 2.
  assert.equal(backListeners.length, 1);
  backListeners[0]();
  await harness.settle();
  assert.ok(harness.texts().includes('Catat transaksi secepat mengetik'));

  // Jump to Saya (Step 4), advance to Step 5, then finish -> returns to Beranda.
  await harness.press('Lihat panduan tab Saya');
  assert.ok(harness.texts().includes('Cicilan, jadwal rutin & daftar belanja'));
  await harness.press('Lanjut');
  assert.ok(harness.texts().includes('Keamanan, tema & tautan akun'));
  await harness.press('Mulai gunakan');
  assert.equal(harness.texts().length, 0);
  assert.equal(navigated.at(-1), '/(tabs)');

  // Reopen manually from Saya -> finishing returns to /(tabs)/me.
  store.openTutorialGuide();
  await harness.settle();
  assert.ok(harness.texts().includes('Ringkasan kas & aktivitas harian'));
  await harness.press('Lewati tutorial');
  assert.equal(harness.texts().length, 0);
  assert.equal(navigated.at(-1), '/(tabs)/me');
});
