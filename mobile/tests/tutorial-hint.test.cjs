/**
 * Unit, layout geometry, target-registry, lifecycle, and spotlight overlay tests
 * for the post-login / new-user tutorial hint.
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

function loadTutorialModules() {
  const targets = loadTsModule(
    path.join(mobileRoot, 'services/tutorialTargets.ts'),
    (name) => {
      throw new Error(`Unexpected import in tutorialTargets.ts: ${name}`);
    }
  );
  const layout = loadTsModule(
    path.join(mobileRoot, 'utils/tutorialLayout.ts'),
    (name) => {
      throw new Error(`Unexpected import in tutorialLayout.ts: ${name}`);
    }
  );
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
  return { targets, layout, steps, store };
}

test('tutorialLayout positions pop-up below upper targets, above lower targets, and computes scroll deltas', () => {
  const { layout } = loadTutorialModules();
  const viewport = { width: 390, height: 844, topInset: 24, bottomReserve: 80 };

  // Upper target -> pop-up placed below with upward arrow.
  const below = layout.computeSpotlightPlacement({ x: 20, y: 96, width: 350, height: 180 }, viewport, 230);
  assert.equal(below.placement, 'below');
  assert.equal(below.arrowDirection, 'up');
  assert.ok(below.cardTop >= below.cutout.y + below.cutout.height);
  assert.equal(below.arrowLeft, 195);

  // Lower target -> pop-up placed above with downward arrow.
  const above = layout.computeSpotlightPlacement({ x: 20, y: 500, width: 350, height: 190 }, viewport, 230);
  assert.equal(above.placement, 'above');
  assert.equal(above.arrowDirection, 'down');
  assert.ok(above.cardTop + 230 <= above.cutout.y);

  // Off-screen target triggers scroll offset calculation; visible target with room returns null.
  assert.equal(
    layout.computeScrollTargetY({ x: 20, y: 96, width: 350, height: 180 }, viewport, 0),
    null
  );
  const scrollNeeded = layout.computeScrollTargetY({ x: 20, y: 780, width: 350, height: 160 }, viewport, 40);
  assert.ok(typeof scrollNeeded === 'number' && scrollNeeded > 40);

  // SVG mask path includes outer rect and inner rounded cutout.
  const svgPath = layout.buildSpotlightMaskPath(390, 844, below.cutout);
  assert.match(svgPath, /^M 0 0 H 390 V 844 H 0 Z M /);
  assert.equal(layout.buildSpotlightMaskPath(390, 844, null), 'M 0 0 H 390 V 844 H 0 Z');
});

test('tutorialTargets registry measures targets and unregisters cleanly', async () => {
  const { targets } = loadTutorialModules();
  assert.equal(await targets.measureTutorialTarget('home.summary'), null);

  const unregister = targets.registerTutorialTarget('home.summary', async () => ({
    x: 16,
    y: 120,
    width: 358,
    height: 170,
  }));
  assert.deepEqual(await targets.measureTutorialTarget('home.summary'), {
    x: 16,
    y: 120,
    width: 358,
    height: 170,
  });

  unregister();
  assert.equal(await targets.measureTutorialTarget('home.summary'), null);
});

test('tutorialHint starts inactive on cold open and activates only after sign-in or manual guide', () => {
  const { steps, store } = loadTutorialModules();
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

test('TutorialHintOverlay renders spotlight cutout, auto-scrolls off-screen targets, and finishes cleanly', async () => {
  const { targets, layout, steps, store } = loadTutorialModules();
  const navigated = [];
  const backListeners = [];
  const scrolledTo = [];
  let meScrollY = 0;

  // Register live target measurements and scroll controller for Beranda & Saya.
  targets.registerTutorialTarget('home.summary', async () => ({
    x: 20,
    y: 110,
    width: 350,
    height: 180,
  }));
  targets.registerTutorialTarget('home.quickInput', async () => ({
    x: 20,
    y: 310,
    width: 350,
    height: 110,
  }));
  targets.registerTutorialTarget('reports.stability', async () => ({
    x: 20,
    y: 220,
    width: 350,
    height: 240,
  }));
  targets.registerTutorialTarget('me.settings', async () => ({
    x: 20,
    y: meScrollY > 0 ? 480 : 790,
    width: 350,
    height: 160,
  }));
  targets.registerTutorialScrollArea('me', {
    scrollTo: (y) => {
      scrolledTo.push(y);
      meScrollY = y;
    },
    getScrollY: () => meScrollY,
  });

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
        useWindowDimensions: () => ({ width: 390, height: 844, scale: 1, fontScale: 1 }),
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
      'react-native-svg': {
        default: (props) => node('Svg', props),
        Svg: (props) => node('Svg', props),
        Path: (props) => node('Path', props),
      },
      'react-native-safe-area-context': {
        useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }),
      },
      '../../utils/theme': {
        Colors: tokenProxy(),
        Fonts: tokenProxy(),
        Motion: { fast: 120, base: 180, slow: 260 },
        Radius: tokenProxy(),
        Space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48, gutter: 20 },
        Type: tokenProxy(),
      },
      '../../utils/motion': { useReducedMotion: () => true },
      '../../utils/tutorialSteps': steps,
      '../../utils/tutorialLayout': layout,
      '../../services/tutorialTargets': targets,
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

  // Unlock app -> Step 1 appears with spotlight cutout framing home.summary.
  harness.update({ authed: true, gated: false, inAuthGroup: false, onNavigateTab: (r) => navigated.push(r) });
  await new Promise((r) => setTimeout(r, 200));
  await harness.settle();
  assert.ok(harness.texts().includes('Selamat datang! Ini ringkasan kasmu'));
  assert.ok(harness.texts().includes('1 / 6 · Beranda'));
  assert.ok(harness.byLabel('Sorotan Beranda'), 'spotlight highlight ring must render');
  assert.ok(harness.allByType('Svg').length >= 1 && harness.allByType('Path').length >= 1);
  assert.match(harness.allByType('Path')[0].props.d, /^M 0 0 H 390 V 844 H 0 Z M /);
  assert.deepEqual(navigated, ['/(tabs)']);

  // Advance to Step 2 (Catat cepat with example chips).
  await harness.press('Lanjut');
  await new Promise((r) => setTimeout(r, 200));
  await harness.settle();
  assert.ok(harness.texts().includes('Catat transaksi secepat mengetik'));
  assert.ok(harness.texts().includes('"crypto xrp 150000"'));
  assert.ok(harness.byLabel('Sorotan Catat cepat'));

  // Jump via spotlight bar directly to Laporan (Step 4 -> tab index 2).
  await harness.press('Lihat panduan tab Laporan');
  await new Promise((r) => setTimeout(r, 200));
  await harness.settle();
  assert.ok(harness.texts().includes('Arus kas pribadi & kurva kestabilan'));
  assert.equal(navigated.at(-1), '/(tabs)/reports');
  assert.ok(harness.byLabel('Sorotan Tab Laporan'));

  // Hardware back steps backward to Step 3 (Tab Catat).
  assert.equal(backListeners.length, 1);
  backListeners[0]();
  await harness.settle();
  assert.ok(harness.texts().includes('Pilih jenis & isi form lengkap'));
  assert.equal(navigated.at(-1), '/(tabs)/add');

  // Jump to Saya (Step 5) then advance to Step 6 (me.settings off-screen -> auto-scrolls).
  await harness.press('Lihat panduan tab Saya');
  assert.ok(harness.texts().includes('Cicilan, anggaran & daftar belanja'));
  await harness.press('Lanjut');
  await new Promise((r) => setTimeout(r, 500));
  await harness.settle();
  assert.ok(scrolledTo.length >= 1, 'off-screen target on Saya must trigger auto-scroll');
  assert.ok(harness.byLabel('Sorotan Pengaturan & Panduan'));

  // Finish tutorial -> closes and returns to Beranda.
  await harness.press('Mulai gunakan');
  assert.equal(harness.texts().length, 0);
  assert.equal(navigated.at(-1), '/(tabs)');

  // Reopen manually from Saya -> skipping returns to /(tabs)/me.
  store.openTutorialGuide();
  await harness.settle();
  assert.ok(harness.texts().includes('Ringkasan kas & ganti periode'));
  await harness.press('Lewati tutorial');
  assert.equal(harness.texts().length, 0);
  assert.equal(navigated.at(-1), '/(tabs)/me');
});
