/**
 * Tiny dependency-free renderer shared by screen-level tests.
 *
 * React hooks are stubbed with deterministic slots, the TSX component is
 * transpiled with a JSX factory, and React Native host components become plain
 * trees. No renderer, native module, network, or timer is required.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const mobileRoot = path.join(__dirname, '..', '..');

function sameDeps(left, right) {
  if (left === undefined || right === undefined) return false;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (!Object.is(left[index], right[index])) return false;
  }
  return true;
}

function createHooks() {
  const hooks = [];
  const refs = [];
  const effectSlots = [];
  let cursor = 0;
  let dirty = false;
  let unmounted = false;

  function useState(initial) {
    const index = cursor;
    cursor += 1;
    if (!hooks[index]) {
      hooks[index] = {
        kind: 'state',
        value: typeof initial === 'function' ? initial() : initial,
      };
    }
    const slot = hooks[index];
    if (!slot.setter) {
      slot.setter = (next) => {
        if (unmounted) return;
        const value = typeof next === 'function' ? next(slot.value) : next;
        if (Object.is(value, slot.value)) return;
        slot.value = value;
        dirty = true;
      };
    }
    return [slot.value, slot.setter];
  }

  function useRef(initial) {
    const index = cursor;
    cursor += 1;
    if (!hooks[index]) {
      hooks[index] = { kind: 'ref', current: initial };
      refs.push(hooks[index]);
    }
    return hooks[index];
  }

  function useCallback(callback, deps) {
    const index = cursor;
    cursor += 1;
    const slot = hooks[index];
    if (!slot || slot.kind !== 'callback') {
      hooks[index] = { kind: 'callback', callback, deps };
    } else if (!sameDeps(slot.deps, deps)) {
      slot.callback = callback;
      slot.deps = deps;
    }
    return hooks[index].callback;
  }

  function useEffect(effect, deps) {
    const index = cursor;
    cursor += 1;
    const slot = hooks[index];
    if (!slot || slot.kind !== 'effect') {
      const next = { kind: 'effect', effect, deps, cleanup: null, pending: true };
      hooks[index] = next;
      effectSlots.push(next);
    } else if (!sameDeps(slot.deps, deps)) {
      slot.effect = effect;
      slot.deps = deps;
      slot.pending = true;
    }
  }

  function useMemo(factory, deps) {
    const index = cursor;
    cursor += 1;
    const slot = hooks[index];
    if (!slot || slot.kind !== 'memo') {
      hooks[index] = { kind: 'memo', value: factory(), deps };
    } else if (!sameDeps(slot.deps, deps)) {
      slot.value = factory();
      slot.deps = deps;
    }
    return hooks[index].value;
  }

  function useSyncExternalStore(_subscribe, getSnapshot) {
    return getSnapshot();
  }

  function runEffects() {
    for (const slot of effectSlots) {
      if (!slot.pending) continue;
      slot.pending = false;
      if (typeof slot.cleanup === 'function') slot.cleanup();
      const cleanup = slot.effect();
      slot.cleanup = typeof cleanup === 'function' ? cleanup : null;
    }
  }

  function unmount() {
    if (unmounted) return;
    unmounted = true;
    for (const slot of effectSlots) {
      if (typeof slot.cleanup === 'function') slot.cleanup();
      slot.cleanup = null;
    }
  }

  return {
    refs,
    useState,
    useRef,
    useCallback,
    useEffect,
    useMemo,
    useSyncExternalStore,
    get dirty() {
      return dirty;
    },
    markClean() {
      dirty = false;
    },
    resetCursor() {
      cursor = 0;
    },
    runEffects,
    unmount,
  };
}

function tokenProxy() {
  const token = new Proxy({}, {
    get(target, key) {
      if (key === 'toString') return () => 'token';
      if (key === Symbol.toPrimitive) return () => 0;
      return token;
    },
  });
  return token;
}

function createAppState() {
  const listeners = new Set();
  return {
    current: 'active',
    module: {
      addEventListener(type, listener) {
        if (type === 'change') listeners.add(listener);
        return { remove: () => listeners.delete(listener) };
      },
    },
    emit(next) {
      this.current = next;
      for (const listener of [...listeners]) listener(next);
    },
  };
}

function createHostComponents() {
  const h = (type, props, ...children) => {
    const merged = { ...(props || {}) };
    const flatChildren = children.flat(Infinity);
    if (flatChildren.length) merged.children = flatChildren;
    if (typeof type === 'function') return type(merged);
    return {
      type,
      props: merged,
      children: flatChildren,
    };
  };

  function Screen(props) {
    return h('View', props, props.children);
  }
  function Input(props) {
    return h('Input', props);
  }
  function Button(props) {
    return h('Pressable', {
      ...props,
      accessibilityRole: 'button',
      accessibilityLabel: props.title,
      disabled: Boolean(props.disabled || props.loading),
    });
  }
  function Checkbox(props) {
    return h('Pressable', {
      ...props,
      accessibilityRole: 'checkbox',
      accessibilityState: { checked: props.checked, disabled: props.disabled },
      accessibilityLabel: props.label,
      onPress: () => props.onChange(!props.checked),
    });
  }
  function ErrorState(props) {
    return h('ErrorState', props);
  }
  function SkeletonRows(props) {
    return h('SkeletonRows', props);
  }
  function PatternInput(props) {
    return h('PatternInput', props);
  }
  function Ionicons(props) {
    return h('Ionicons', props);
  }

  return {
    h,
    ui: {
      Screen,
      Input,
      Button,
      Checkbox,
      ErrorState,
      SkeletonRows,
    },
    security: { PatternInput },
    Ionicons,
  };
}

function loadTsModule(file, requireFor) {
  const source = fs.readFileSync(file, 'utf8');
  const sandbox = {
    exports: {},
    module: { exports: {} },
    console,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    setImmediate,
    Error,
  };
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.require = requireFor;
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: false,
    },
  }).outputText;
  vm.runInNewContext(javascript, sandbox, { filename: file });
  return Object.keys(sandbox.module.exports).length
    ? sandbox.module.exports
    : sandbox.exports;
}

const mobileModuleCache = new Map();

function resolveMobileFile(fromDir, specifier) {
  const base = path.resolve(fromDir, specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

/**
 * Transpile and evaluate a real mobile module (TS or TSX) in the VM.
 *
 * Relative imports are resolved from the importing file, so a screen test can
 * fall back to the production pure helpers instead of reimplementing them. Only
 * pure modules are loaded this way; components that need hooks or host stubs
 * still come from the harness `modules` map.
 */
function loadMobileModule(specifier, fromDir = mobileRoot, stubs = {}) {
  const file = resolveMobileFile(fromDir, specifier);
  if (!file) {
    throw new Error(`Cannot resolve ${specifier} from ${fromDir}`);
  }
  if (mobileModuleCache.has(file)) return mobileModuleCache.get(file);
  const exported = loadTsModule(file, (name) => {
    if (name.startsWith('.')) {
      return loadMobileModule(name, path.dirname(file), stubs);
    }
    if (stubs[name] !== undefined) return stubs[name];
    throw new Error(`Unexpected module in ${file}: ${name}`);
  });
  mobileModuleCache.set(file, exported);
  return exported;
}

/**
 * Load a real presentational component module (no hooks) with the harness host
 * components. Used when a screen test must assert the production markup of a
 * small shared component such as SectionHeader instead of stubbing it.
 */
function loadComponentModule(componentPath, options = {}) {
  const hooks = createHooks();
  const host = createHostComponents();
  return loadComponent(
    componentPath,
    options.modules || {},
    hooks,
    host.h,
    options.moduleFallback || [],
    options.exportName
  );
}

function loadComponent(componentPath, modules, hooks, h, moduleFallback = [], exportName) {
  const file = path.join(mobileRoot, componentPath);
  const source = fs.readFileSync(file, 'utf8');
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: false,
      jsx: ts.JsxEmit.React,
      jsxFactory: 'h',
    },
  }).outputText;

  const sandbox = {
    exports: {},
    module: { exports: {} },
    console,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    setImmediate,
    Date,
    Math,
    Promise,
    Object,
    Array,
    Set,
    Map,
    JSON,
    Number,
    String,
    Boolean,
    Error,
    isFinite: Number.isFinite,
  };
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.h = h;
  sandbox.require = (name) => {
    if (modules[name] !== undefined) return modules[name];
    for (const [matcher, value] of moduleFallback) {
      if (matcher instanceof RegExp ? matcher.test(name) : name === matcher) {
        return value;
      }
    }
    if (/^\.\.?(?:\/\.\.)*\/utils\//.test(name)) {
      return loadMobileModule(name, path.dirname(file));
    }
    throw new Error(`Unexpected module in ${componentPath}: ${name}`);
  };

  vm.runInNewContext(javascript, sandbox, { filename: file });
  const exported = Object.keys(sandbox.module.exports).length
    ? sandbox.module.exports
    : sandbox.exports;
  if (exportName && exported[exportName] !== undefined) {
    return exported[exportName];
  }
  return exported.default || exported.AppLockSettingsScreen || exported.DeleteAccountScreen;
}

function elements(rootNode) {
  const found = [];
  function visit(node) {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') return;
    if (node.type !== undefined) found.push(node);
    (node.children || []).forEach(visit);
  }
  visit(rootNode);
  return found;
}

function collectText(node, output = []) {
  if (Array.isArray(node)) {
    node.forEach((child) => collectText(child, output));
    return output;
  }
  if (!node || typeof node !== 'object') {
    if (typeof node === 'string' || typeof node === 'number') output.push(String(node));
    return output;
  }
  (node.children || []).forEach((child) => collectText(child, output));
  return output;
}

function createHarness({ componentPath, modules, props = {}, mountProps, moduleFallback = [], exportName }) {
  const hooks = createHooks();
  const host = createHostComponents();
  const focusCallbacks = [];
  const React = {
    useState: hooks.useState,
    useRef: hooks.useRef,
    useCallback: hooks.useCallback,
    useEffect: hooks.useEffect,
    useMemo: hooks.useMemo,
    useSyncExternalStore: hooks.useSyncExternalStore,
    createElement: host.h,
  };
  React.default = React;

  const appState = createAppState();
  const baseModules = {
    react: React,
    'react-native': {
      ActivityIndicator: 'ActivityIndicator',
      Animated: { View: 'Animated.View', Value: class { constructor(value) { this.value = value; } } },
      AppState: appState.module,
      Pressable: 'Pressable',
      StyleSheet: {
        create: (styles) => styles,
        absoluteFill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
      },
      Switch: 'Switch',
      Text: 'Text',
      View: 'View',
    },
    'expo-router': {
      router: { back() {}, replace() {}, push() {} },
      useFocusEffect: (callback) => {
        focusCallbacks.length = 0;
        focusCallbacks.push(callback);
        return hooks.useEffect(callback, [callback]);
      },
      useLocalSearchParams: () => ({}),
    },
    '@expo/vector-icons': { Ionicons: host.Ionicons },
    '../utils/theme': {
      Colors: tokenProxy(),
      Fonts: tokenProxy(),
      Radius: tokenProxy(),
      Space: tokenProxy(),
      Type: tokenProxy(),
    },
    '../components/ui/Screen': { Screen: host.ui.Screen },
    '../components/ui/Input': { Input: host.ui.Input },
    '../components/ui/Button': { Button: host.ui.Button },
    '../components/ui/Checkbox': { Checkbox: host.ui.Checkbox },
    '../components/ui/ErrorState': { ErrorState: host.ui.ErrorState },
    '../components/ui/Skeleton': { SkeletonRows: host.ui.SkeletonRows },
    '../components/security/PatternInput': { PatternInput: host.security.PatternInput },
  };

  const mergedModules = { ...baseModules };
  for (const [name, value] of Object.entries(modules || {})) {
    mergedModules[name] = baseModules[name] && typeof baseModules[name] === 'object' &&
      value && typeof value === 'object'
      ? { ...baseModules[name], ...value }
      : value;
  }
  const defaultThemeService = {
    useTheme: () => ({
      mode: 'light',
      isDark: false,
      colors: tokenProxy(),
      type: tokenProxy(),
      shadow: tokenProxy(),
      setThemeMode: async () => {},
    }),
    createThemedStyles: (factory) => (theme) => factory(theme || {
      mode: 'light',
      isDark: false,
      colors: tokenProxy(),
      type: tokenProxy(),
      shadow: tokenProxy(),
    }),
  };

  const defaultInstallmentRemindersService = {
    useInstallmentReminders: () => ({
      ready: true,
      enabled: true,
      hour: 9,
      minute: 0,
      permission: 'unknown',
      scheduledCount: 0,
      supported: true,
    }),
    getInstallmentReminderState: () => ({
      ready: true,
      enabled: true,
      hour: 9,
      minute: 0,
      permission: 'unknown',
      scheduledCount: 0,
      supported: true,
    }),
    subscribeInstallmentReminders: () => () => {},
    hydrateInstallmentReminders: async () => ({}),
    requestInstallmentNotificationPermission: async () => 'unknown',
    setInstallmentRemindersEnabled: async () => 'unknown',
    setInstallmentReminderTime: async () => {},
    syncInstallmentReminders: async () => 0,
    syncInstallmentRemindersFromApi: async () => 0,
    sendTestInstallmentNotification: async () => {},
  };

  const defaultTutorialTargetComponent = {
    TutorialTarget: ({ children }) => children,
  };

  const defaultTutorialTargetsService = {
    registerTutorialTarget: () => () => {},
    registerTutorialScrollArea: () => () => {},
    notifyTutorialTargetsChanged: () => {},
    subscribeTutorialTargets: () => () => {},
    measureTutorialTarget: async () => null,
    getTutorialScrollArea: () => undefined,
  };

  const mergedFallbacks = [
    ...moduleFallback,
    [/^(?:\.\.\/)+services\/theme$/, defaultThemeService],
    [/^(?:\.\.\/)+services\/installmentNotifications$/, defaultInstallmentRemindersService],
    [/^(?:\.\.\/)+(?:components\/)?tutorial\/TutorialTarget$/, defaultTutorialTargetComponent],
    [/^(?:\.\.\/)+services\/tutorialTargets$/, defaultTutorialTargetsService],
  ];

  const Component = loadComponent(
    componentPath,
    mergedModules,
    hooks,
    host.h,
    mergedFallbacks,
    exportName
  );
  let currentProps = { ...props };
  let tree = null;

  function renderOnce() {
    hooks.resetCursor();
    tree = Component(currentProps);
    hooks.runEffects();
  }

  function flush() {
    let guard = 0;
    do {
      hooks.markClean();
      renderOnce();
    } while (hooks.dirty && (guard += 1) < 50);
  }

  async function settle() {
    for (let tick = 0; tick < 30; tick += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      if (hooks.dirty) flush();
      await new Promise((resolve) => setImmediate(resolve));
      if (!hooks.dirty) {
        flush();
        return;
      }
    }
    assert.fail('screen did not settle');
  }

  async function mount() {
    currentProps = { ...currentProps, ...(mountProps || {}) };
    flush();
    await settle();
    return harness;
  }

  function update(patch) {
    currentProps = { ...currentProps, ...patch };
    flush();
  }

  function byLabel(label) {
    return elements(tree).find((element) => element.props.accessibilityLabel === label);
  }

  function byType(type) {
    return elements(tree).find((element) => element.type === type);
  }

  function byTestID(testID) {
    return elements(tree).find((element) => element.props.testID === testID);
  }

  function allByTestID(testID) {
    return elements(tree).filter((element) => element.props.testID === testID);
  }

  function allByType(type) {
    return elements(tree).filter((element) => element.type === type);
  }

  async function press(label) {
    const target = byLabel(label);
    assert.ok(target, `control ${label} must be rendered`);
    assert.equal(target.props.disabled, false, `control ${label} must be enabled`);
    assert.equal(typeof target.props.onPress, 'function', `control ${label} must be pressable`);
    const result = target.props.onPress();
    flush();
    if (result && typeof result.then === 'function') {
      await result;
      await settle();
    } else {
      await settle();
    }
    return result;
  }

  function change(label, value) {
    const target = byLabel(label);
    assert.ok(target, `input ${label} must be rendered`);
    assert.equal(typeof target.props.onChangeText, 'function', `input ${label} must accept text`);
    target.props.onChangeText(value);
    flush();
  }

  async function pressTestID(testID) {
    const target = byTestID(testID);
    assert.ok(target, `control ${testID} must be rendered`);
    assert.equal(target.props.disabled, false, `control ${testID} must be enabled`);
    assert.equal(typeof target.props.onPress, 'function', `control ${testID} must be pressable`);
    const result = target.props.onPress();
    flush();
    if (result && typeof result.then === 'function') {
      await result;
      await settle();
    } else {
      await settle();
    }
    return result;
  }

  function changeTestID(testID, value) {
    const target = byTestID(testID);
    assert.ok(target, `input ${testID} must be rendered`);
    assert.equal(typeof target.props.onChangeText, 'function', `input ${testID} must accept text`);
    target.props.onChangeText(value);
    flush();
  }

  async function focus() {
    for (const callback of focusCallbacks) callback();
    flush();
    await settle();
  }

  function patternChange(label, pattern) {
    const target = byLabel(label);
    assert.ok(target, `pattern input ${label} must be rendered`);
    assert.equal(typeof target.props.onChange, 'function');
    target.props.onChange(pattern);
    flush();
  }

  const harness = {
    React,
    h: host.h,
    appState,
    get tree() {
      return tree;
    },
    get props() {
      return currentProps;
    },
    elements: () => elements(tree),
    texts: () => collectText(tree),
    textMatching(regex) {
      return collectText(tree).find((text) => regex.test(text));
    },
    byLabel,
    byType,
    allByType,
    byTestID,
    allByTestID,
    mount,
    update,
    flush,
    settle,
    press,
    pressTestID,
    change,
    changeTestID,
    focus,
    patternChange,
    unmount: hooks.unmount,
    refs: hooks.refs,
  };
  return harness;
}

module.exports = {
  createHarness,
  loadComponentModule,
  loadTsModule,
  loadMobileModule,
  mobileRoot,
  tokenProxy,
};