/**
 * Unit and contract tests for Light/Dark theme tokens, contrast, persistence,
 * race-safe hydration, and themed stylesheet caching.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const { loadTsModule, mobileRoot } = require('./support/screen-harness.cjs');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function parseHexRgb(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  assert.ok(match, `expected 6-digit hex color, got ${hex}`);
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function relativeLuminance([r, g, b]) {
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(fgHex, bgHex) {
  const l1 = relativeLuminance(parseHexRgb(fgHex));
  const l2 = relativeLuminance(parseHexRgb(bgHex));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function createThemeHarness(options = {}) {
  const store = new Map(Object.entries(options.initialStore || {}));
  const webStore = new Map(Object.entries(options.initialWebStore || {}));
  const systemBgCalls = [];
  const secureReads = [];
  const secureWrites = [];
  const os = options.os || 'android';

  const themeUtils = loadTsModule(path.join(mobileRoot, 'utils/theme.ts'), (name) => {
    throw new Error(`utils/theme.ts must stay pure, unexpected import: ${name}`);
  });

  const storageMock = os === 'web'
    ? {
        getItem: (key) => (webStore.has(key) ? webStore.get(key) : null),
        setItem: (key, value) => {
          if (options.webWriteError) throw options.webWriteError;
          webStore.set(key, String(value));
        },
      }
    : undefined;

  let currentSnapshot = themeUtils.getActiveTheme();
  const useSyncExternalStore = (subscribe, getSnapshot) => {
    currentSnapshot = getSnapshot();
    return currentSnapshot;
  };

  const serviceFile = path.join(mobileRoot, 'services/theme.ts');
  const serviceJs = ts.transpileModule(fs.readFileSync(serviceFile, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: false },
  }).outputText;
  const serviceSandbox = {
    exports: {},
    module: { exports: {} },
    console,
    Promise,
    Error,
    localStorage: storageMock,
  };
  serviceSandbox.global = serviceSandbox;
  serviceSandbox.globalThis = serviceSandbox;
  serviceSandbox.require = (name) => {
    if (name === '../utils/theme') return themeUtils;
    if (name === 'react') return { useSyncExternalStore };
    if (name === 'react-native') return { Platform: { OS: os } };
    if (name === 'expo-secure-store') {
      return {
        getItemAsync: async (key) => {
          secureReads.push(key);
          if (options.onGetItem) return options.onGetItem(key, store);
          return store.has(key) ? store.get(key) : null;
        },
        setItemAsync: async (key, value) => {
          secureWrites.push([key, value]);
          if (options.onSetItem) return options.onSetItem(key, value, store);
          store.set(key, value);
        },
      };
    }
    if (name === 'expo-system-ui') {
      if (options.missingSystemUi) throw new Error('Missing ExpoSystemUI');
      return {
        setBackgroundColorAsync: async (color) => {
          systemBgCalls.push(color);
        },
      };
    }
    throw new Error(`Unexpected module in services/theme.ts: ${name}`);
  };
  vm.runInNewContext(serviceJs, serviceSandbox, { filename: serviceFile });
  const service = Object.keys(serviceSandbox.module.exports).length
    ? serviceSandbox.module.exports
    : serviceSandbox.exports;

  return {
    themeUtils,
    service,
    store,
    webStore,
    systemBgCalls,
    secureReads,
    secureWrites,
    restore() {},
  };
}

test('LightColors and DarkColors define identical keys and meet WCAG AA text contrast', () => {
  const { themeUtils } = createThemeHarness();
  const { LightColors, DarkColors } = themeUtils;

  assert.deepEqual(Object.keys(DarkColors).sort(), Object.keys(LightColors).sort());

  for (const [label, palette] of [
    ['light', LightColors],
    ['dark', DarkColors],
  ]) {
    for (const bgKey of ['paper', 'surface', 'surfaceAlt']) {
      for (const fgKey of ['ink', 'inkSoft', 'inkMuted']) {
        const ratio = contrastRatio(palette[fgKey], palette[bgKey]);
        assert.ok(
          ratio >= 4.5,
          `${label} ${fgKey} (${palette[fgKey]}) on ${bgKey} (${palette[bgKey]}) contrast ${ratio.toFixed(2)} < 4.5`
        );
      }
    }
    for (const semanticKey of ['income', 'expense', 'investment', 'debt', 'receivable', 'danger']) {
      for (const bgKey of ['paper', 'surface']) {
        const ratio = contrastRatio(palette[semanticKey], palette[bgKey]);
        assert.ok(
          ratio >= 4.5,
          `${label} ${semanticKey} on ${bgKey} contrast ${ratio.toFixed(2)} < 4.5`
        );
      }
    }
    const onInkRatio = contrastRatio(palette.onInk, palette.ink);
    assert.ok(onInkRatio >= 10, `${label} onInk on ink contrast ${onInkRatio.toFixed(2)}`);
  }
});

test('default theme is light and hydrateTheme restores stored dark preference', async () => {
  const h = createThemeHarness({
    initialStore: { 'finance.themeMode.v1': 'dark' },
  });
  assert.equal(h.service.useTheme().mode, 'light');
  assert.equal(h.service.useTheme().isDark, false);

  const hydrated = await h.service.hydrateTheme();
  assert.equal(hydrated, 'dark');
  const active = h.service.useTheme();
  assert.equal(active.mode, 'dark');
  assert.equal(active.isDark, true);
  assert.equal(active.colors.paper, h.themeUtils.DarkColors.paper);
  assert.deepEqual(h.systemBgCalls, [h.themeUtils.DarkColors.paper]);
});

test('corrupt stored values and SecureStore read failures fall back safely to light', async () => {
  const corrupt = createThemeHarness({
    initialStore: { 'finance.themeMode.v1': 'midnight-neon' },
  });
  assert.equal(await corrupt.service.hydrateTheme(), 'light');
  assert.equal(corrupt.service.useTheme().mode, 'light');

  const failing = createThemeHarness({
    onGetItem: async () => {
      throw new Error('Keystore locked');
    },
  });
  assert.equal(await failing.service.hydrateTheme(), 'light');
  assert.equal(failing.service.useTheme().mode, 'light');
});

test('setThemeMode updates subscribers immediately, syncs system background, and persists in order', async () => {
  const firstWrite = deferred();
  const secondWrite = deferred();
  let writeCount = 0;
  const h = createThemeHarness({
    onSetItem: async (key, value, store) => {
      writeCount += 1;
      if (writeCount === 1) await firstWrite.promise;
      if (writeCount === 2) await secondWrite.promise;
      store.set(key, value);
    },
  });

  const notifications = [];
  const unsubscribe = h.themeUtils.subscribeActiveTheme(() => {
    notifications.push(h.themeUtils.getActiveTheme().mode);
  });

  const p1 = h.service.setThemeMode('dark');
  assert.equal(h.service.useTheme().mode, 'dark');
  const p2 = h.service.setThemeMode('light');
  assert.equal(h.service.useTheme().mode, 'light');
  assert.deepEqual(notifications, ['dark', 'light']);

  firstWrite.resolve();
  secondWrite.resolve();
  await Promise.all([p1, p2]);
  unsubscribe();

  assert.equal(h.secureWrites.length, 1);
  assert.deepEqual(h.secureWrites[0], ['finance.themeMode.v1', 'light']);
  assert.equal(h.store.get('finance.themeMode.v1'), 'light');
  assert.deepEqual(h.systemBgCalls, [
    h.themeUtils.DarkColors.paper,
    h.themeUtils.LightColors.paper,
  ]);
});

test('slow hydrateTheme cannot overwrite a newer user selection', async () => {
  const readPending = deferred();
  const h = createThemeHarness({
    onGetItem: () => readPending.promise,
  });

  const hydrating = h.service.hydrateTheme();
  await h.service.setThemeMode('dark');
  assert.equal(h.service.useTheme().mode, 'dark');

  readPending.resolve('light');
  const result = await hydrating;
  assert.equal(result, 'dark');
  assert.equal(h.service.useTheme().mode, 'dark');
});

test('web theme persistence reads and writes localStorage without SecureStore', async (t) => {
  const h = createThemeHarness({
    os: 'web',
    initialWebStore: { 'finance.themeMode.v1': 'dark' },
    missingSystemUi: true,
  });
  t.after(() => h.restore());

  assert.equal(await h.service.hydrateTheme(), 'dark');
  assert.equal(h.secureReads.length, 0);

  await h.service.setThemeMode('light');
  assert.equal(h.webStore.get('finance.themeMode.v1'), 'light');
  assert.equal(h.secureWrites.length, 0);
});

test('createThemedStyles caches style objects per theme and updates when mode switches', () => {
  const { themeUtils } = createThemeHarness();
  let builds = 0;
  const useStyles = themeUtils.createThemedStyles(({ colors }) => {
    builds += 1;
    return { screen: { backgroundColor: colors.paper }, text: { color: colors.ink } };
  });

  const light1 = useStyles(themeUtils.getThemeTokens('light'));
  const light2 = useStyles(themeUtils.getThemeTokens('light'));
  assert.equal(light1, light2);
  assert.equal(light1.screen.backgroundColor, themeUtils.LightColors.paper);
  assert.equal(builds, 1);

  const dark1 = useStyles(themeUtils.getThemeTokens('dark'));
  assert.equal(dark1.screen.backgroundColor, themeUtils.DarkColors.paper);
  assert.equal(dark1.text.color, themeUtils.DarkColors.ink);
  assert.equal(builds, 2);

  const dark2 = useStyles(themeUtils.getThemeTokens('dark'));
  assert.equal(dark1, dark2);
  assert.equal(builds, 2);
});
