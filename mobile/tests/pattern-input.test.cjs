/**
 * Runtime interaction tests for the 3x3 pattern grid without adding a renderer
 * dependency. The TSX component is transpiled with a tiny JSX factory, React
 * hooks are stubbed with deterministic slots, and React Native host components
 * are plain trees whose event props the test invokes directly.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.join(__dirname, '..');
const COMPONENT_PATH = path.join(root, 'components/security/PatternInput.tsx');
const HELPER_PATH = path.join(root, 'utils/lockPattern.ts');

const NODE_LABELS = {
  0: 'Titik baris 1 kolom 1 (kiri atas)',
  1: 'Titik baris 1 kolom 2 (tengah atas)',
  2: 'Titik baris 1 kolom 3 (kanan atas)',
  3: 'Titik baris 2 kolom 1 (kiri tengah)',
  4: 'Titik baris 2 kolom 2 (tengah)',
  5: 'Titik baris 2 kolom 3 (kanan tengah)',
  6: 'Titik baris 3 kolom 1 (kiri bawah)',
  7: 'Titik baris 3 kolom 2 (tengah bawah)',
  8: 'Titik baris 3 kolom 3 (kanan bawah)',
};

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
  const effectSlots = new Set();
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
      hooks[index] = { kind: 'effect', effect, deps, cleanup: null, pending: true };
      effectSlots.add(hooks[index]);
    } else if (!sameDeps(slot.deps, deps)) {
      slot.effect = effect;
      slot.deps = deps;
      slot.pending = true;
    }
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
    hooks,
    refs,
    useState,
    useRef,
    useCallback,
    useEffect,
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
    isUnmounted() {
      return unmounted;
    },
  };
}

function createRenderer() {
  const hook = createHooks();
  let props = {};
  let tree = null;
  let Component = null;

  const React = {
    useState: hook.useState,
    useRef: hook.useRef,
    useCallback: hook.useCallback,
    useEffect: hook.useEffect,
    createElement: h,
  };
  React.default = React;

  function h(type, nextProps, ...children) {
    return {
      type,
      props: nextProps || {},
      children: children.flat(Infinity),
    };
  }

  function renderOnce() {
    hook.resetCursor();
    tree = Component(props);
    hook.runEffects();
  }

  function flush() {
    let guard = 0;
    do {
      hook.markClean();
      renderOnce();
    } while (hook.dirty && (guard += 1) < 20);
  }

  function mount(initialProps) {
    props = { ...initialProps };
    flush();
  }

  function setProps(patch) {
    props = { ...props, ...patch };
  }

  function update(patch) {
    setProps(patch);
    flush();
  }

  function act(callback) {
    const result = callback();
    flush();
    return result;
  }

  return {
    React,
    h,
    setComponent(next) {
      Component = next;
    },
    setProps,
    mount,
    update,
    act,
    flush,
    unmount: hook.unmount,
    refs: hook.refs,
    get tree() {
      return tree;
    },
    get props() {
      return props;
    },
  };
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

function byLabel(tree, label) {
  return elements(tree).find((element) => element.props.accessibilityLabel === label);
}

function boardElement(tree) {
  return elements(tree).find(
    (element) => element.props.accessible === true &&
      typeof element.props.onResponderGrant === 'function',
  );
}

function createPatternInput(initialProps = {}) {
  const renderer = createRenderer();
  const helperModule = loadHelper();
  const componentModule = loadComponent(helperModule, renderer.React);
  renderer.setComponent(componentModule.PatternInput);

  let value = Array.from(initialProps.value || []);
  const changes = [];
  const onChange = (next) => {
    const copy = Array.from(next);
    changes.push(copy);
    value = copy;
    renderer.setProps({ value });
  };

  renderer.mount({ ...initialProps, value, onChange });
  return {
    renderer,
    changes,
    value: () => value,
    board: () => boardElement(renderer.tree),
    draw(x, y) {
      const board = boardElement(renderer.tree);
      assert.ok(board, 'draw board must be rendered');
      renderer.act(() => board.props.onResponderGrant({ nativeEvent: { locationX: x, locationY: y } }));
    },
    move(x, y) {
      const board = boardElement(renderer.tree);
      assert.ok(board, 'draw board must be rendered');
      renderer.act(() => board.props.onResponderMove({ nativeEvent: { locationX: x, locationY: y } }));
    },
    release() {
      const board = boardElement(renderer.tree);
      renderer.act(() => board.props.onResponderRelease());
    },
    terminate() {
      const board = boardElement(renderer.tree);
      renderer.act(() => board.props.onResponderTerminate());
    },
    start(x, y) {
      const board = boardElement(renderer.tree);
      assert.ok(board, 'draw board must be rendered');
      return board.props.onStartShouldSetResponder({
        nativeEvent: { locationX: x, locationY: y },
      });
    },
    moveShouldSet() {
      const board = boardElement(renderer.tree);
      assert.ok(board, 'draw board must be rendered');
      return board.props.onMoveShouldSetResponder();
    },
    clear() {
      const button = byLabel(renderer.tree, 'Hapus pola');
      assert.ok(button, 'clear control must be rendered');
      renderer.act(() => button.props.onPress());
    },
  };
}

function loadTsModule(file, requireFor) {
  const source = fs.readFileSync(file, 'utf8');
  const sandbox = { exports: {}, module: { exports: {} }, console };
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

function loadHelper() {
  return loadTsModule(HELPER_PATH, (name) => {
    throw new Error(`Unexpected module in lock pattern helpers: ${name}`);
  });
}

function loadComponent(helperModule, React) {
  const token = new Proxy({}, {
    get(target, key) {
      if (key === 'toString') return () => 'token';
      if (key === Symbol.toPrimitive) return () => 0;
      return token;
    },
  });
  const theme = {
    Colors: new Proxy({}, { get: (_target, key) => `color:${String(key)}` }),
    Fonts: token,
    Radius: token,
    Space: token,
    Type: token,
  };

  const themeService = {
    useTheme: () => ({
      mode: 'light',
      isDark: false,
      colors: theme.Colors,
      type: theme.Type,
      shadow: token,
      setThemeMode: async () => {},
    }),
    createThemedStyles: (factory) => (resolved) => factory(resolved),
  };

  const reactNative = {
    View: 'View',
    Text: 'Text',
    Pressable: 'Pressable',
    StyleSheet: {
      create: (styles) => styles,
      absoluteFill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
    },
  };

  const source = fs.readFileSync(COMPONENT_PATH, 'utf8');
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: false,
      jsx: ts.JsxEmit.React,
      jsxFactory: 'h',
    },
  }).outputText;

  const sandbox = { exports: {}, module: { exports: {} }, console };
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.h = (type, props, ...children) => ({
    type,
    props: props || {},
    children: children.flat(Infinity),
  });
  sandbox.require = (name) => {
    switch (name) {
      case 'react':
        return React;
      case 'react-native':
        return reactNative;
      case '../../utils/theme':
        return theme;
      case '../../services/theme':
        return themeService;
      case '../../utils/lockPattern':
        return helperModule;
      default:
        throw new Error(`Unexpected module in PatternInput: ${name}`);
    }
  };

  vm.runInNewContext(javascript, sandbox, { filename: COMPONENT_PATH });
  return Object.keys(sandbox.module.exports).length
    ? sandbox.module.exports
    : sandbox.exports;
}

test('draw responder appends touched nodes, auto-inserts a midpoint, and stops after release', () => {
  const grid = createPatternInput();

  grid.draw(40, 40);
  assert.deepEqual(grid.value(), [0]);

  grid.move(200, 40);
  assert.deepEqual(grid.value(), [0, 1, 2], 'straight jump must visit its midpoint');

  grid.move(200, 120);
  assert.deepEqual(grid.value(), [0, 1, 2, 5]);

  grid.release();
  grid.move(200, 200);
  assert.deepEqual(grid.value(), [0, 1, 2, 5], 'moves after release must be ignored');

  grid.terminate();
  assert.deepEqual(grid.value(), [0, 1, 2, 5], 'terminate after release must be a no-op');
});

test('board misses preserve the draft, reject responder claims, and leave scrolling available', () => {
  const grid = createPatternInput();
  grid.draw(40, 40);
  grid.move(200, 40);
  assert.deepEqual(grid.value(), [0, 1, 2]);
  grid.release();

  assert.equal(grid.start(10, 10), false, 'empty board space must not claim the gesture');
  assert.equal(grid.moveShouldSet(), false, 'moves must not hijack an existing scroll');

  const before = grid.changes.length;
  grid.draw(10, 10);
  assert.deepEqual(grid.value(), [0, 1, 2], 'a miss must not clear an existing draft');
  assert.equal(grid.changes.length, before, 'a miss must not emit a pattern change');
  assert.equal(grid.renderer.refs[1].current, false, 'a miss must not start drawing');

  grid.move(200, 120);
  assert.deepEqual(grid.value(), [0, 1, 2], 'a miss must not resume drawing');

  const empty = createPatternInput();
  assert.equal(empty.start(10, 10), false);
  assert.equal(empty.moveShouldSet(), false);
  assert.equal(empty.start(40, 40), true, 'a hit node must claim the gesture');
  empty.draw(40, 40);
  assert.deepEqual(empty.value(), [0]);

  empty.renderer.update({ disabled: true });
  assert.equal(empty.start(40, 40), false, 'disabled input must not claim the gesture');
});

test('responder terminate clears the partially drawn pattern', () => {
  const grid = createPatternInput();

  grid.draw(40, 40);
  grid.move(120, 120);
  assert.deepEqual(grid.value(), [0, 4]);

  grid.terminate();
  assert.deepEqual(grid.value(), []);

  grid.move(120, 40);
  assert.deepEqual(grid.value(), [], 'a terminated gesture must not resume');
});

test('tap mode UI is absent and only the drag board selects nodes', () => {
  const grid = createPatternInput();
  const all = elements(grid.renderer.tree);

  for (const label of ['Mode ketuk titik berurutan', 'Mode garis sentuh']) {
    assert.equal(byLabel(grid.renderer.tree, label), undefined, `${label} must not be rendered`);
  }
  for (const label of Object.values(NODE_LABELS)) {
    assert.equal(
      byLabel(grid.renderer.tree, label),
      undefined,
      'individual tap targets must not be rendered',
    );
  }
  assert.equal(
    all.some((element) => typeof element.props.onPress === 'function' &&
      element.props.accessibilityRole === 'button' &&
      element.props.accessibilityLabel !== 'Hapus pola'),
    false,
    'the grid must expose no tap-to-select buttons',
  );

  assert.ok(grid.board(), 'the drag board remains the only pattern input');
  grid.draw(40, 40);
  grid.move(200, 40);
  assert.deepEqual(grid.value(), [0, 1, 2], 'drag remains the only node selection path');
  assert.equal(
    grid.renderer.refs[1].current,
    true,
    'the active drag latch stays owned by the responder',
  );
});

test('the default grid exposes no submit control or completion callback unless opted in', () => {
  const grid = createPatternInput();
  const all = elements(grid.renderer.tree);

  assert.equal(all.some((element) => element.props.onSubmit), false);
  assert.equal(all.some((element) => element.props.onComplete), false);
  assert.equal(
    all.some((element) => /simpan|kirim|lanjut|submit/i.test(String(element.props.accessibilityLabel || ''))),
    false,
  );
});

test('clear resets the pattern, disables itself when empty, and empties the active drawing', () => {
  const grid = createPatternInput();

  grid.draw(40, 40);
  grid.move(120, 120);
  assert.deepEqual(grid.value(), [0, 4]);

  grid.clear();
  assert.deepEqual(grid.value(), []);
  const clearButton = byLabel(grid.renderer.tree, 'Hapus pola');
  assert.equal(clearButton.props.disabled, true);
  assert.equal(clearButton.props.accessibilityState.disabled, true);

  const before = grid.changes.length;
  grid.clear();
  assert.equal(grid.changes.length, before, 'clearing an empty grid must not emit a change');

  grid.move(200, 40);
  assert.deepEqual(grid.value(), [], 'drawing must stay reset after the pattern is emptied');
});

test('disabled and empty values reset the drawing latch, and disabled input is ignored', () => {
  const grid = createPatternInput();

  grid.draw(40, 40);
  assert.deepEqual(grid.value(), [0]);

  grid.renderer.update({ disabled: true });
  assert.equal(grid.renderer.refs[1].current, false, 'disabled must reset the drawing latch');

  const before = grid.changes.length;
  grid.draw(200, 200);
  assert.equal(grid.changes.length, before, 'disabled draw input must be ignored');

  grid.renderer.update({ disabled: false });
  grid.move(120, 120);
  assert.deepEqual(grid.value(), [0], 'a latch reset by disabled must not resume on re-enable');

  grid.clear();
  grid.renderer.update({ disabled: false });
  assert.equal(grid.renderer.refs[1].current, false);
  grid.move(120, 120);
  assert.deepEqual(grid.value(), [], 'an empty pattern must keep the drawing latch reset');
});

test('unmount clears the active pattern and drawing refs', () => {
  const grid = createPatternInput();

  grid.draw(40, 40);
  assert.deepEqual(grid.renderer.refs[0].current, [0]);
  assert.equal(grid.renderer.refs[1].current, true);

  const staleBoard = grid.board();
  const before = grid.changes.length;
  grid.renderer.unmount();

  assert.deepEqual(Array.from(grid.renderer.refs[0].current), []);
  assert.equal(grid.renderer.refs[1].current, false);

  staleBoard.props.onResponderMove({ nativeEvent: { locationX: 120, locationY: 120 } });
  assert.equal(grid.changes.length, before, 'a stale handler after unmount must not emit a change');
});

test('vertical drags suspend parent scrolling only until the gesture ends', () => {
  for (const [startY, endY, expected] of [[40, 200, [0, 3, 6, 7]], [200, 40, [6, 3, 0, 1]]]) {
    const grid = createPatternInput();
    const drawingChanges = [];
    grid.renderer.update({ onDrawingChange: (drawing) => drawingChanges.push(drawing) });
    const event = { nativeEvent: { locationX: 40, locationY: startY } };
    assert.equal(grid.board().props.onStartShouldSetResponderCapture(event), true);
    grid.draw(40, startY);
    assert.deepEqual(drawingChanges, [true], 'a node-started drag must suspend scrolling immediately');
    assert.equal(grid.board().props.onResponderTerminationRequest(), false);
    grid.move(40, endY);
    grid.move(120, endY);
    assert.deepEqual(grid.value(), expected, 'vertical movement must keep collecting pattern nodes');
    assert.deepEqual(drawingChanges, [true], 'moving must not release the scroll lock');
    grid.release();
    assert.deepEqual(drawingChanges, [true, false]);
    assert.deepEqual(grid.value(), expected, 'release preserves the completed pattern');
    grid.renderer.unmount();
    assert.deepEqual(drawingChanges, [true, false], 'cleanup after release must not notify twice');
  }
});

test('every interrupted drawing path restores parent scrolling exactly once', () => {
  for (const reason of ['terminate', 'clear', 'disable', 'empty', 'unmount']) {
    const grid = createPatternInput();
    const drawingChanges = [];
    grid.renderer.update({ onDrawingChange: (drawing) => drawingChanges.push(drawing) });
    grid.draw(40, 40);
    grid.move(40, 200);
    if (reason === 'terminate') grid.terminate();
    else if (reason === 'clear') grid.clear();
    else if (reason === 'disable') grid.renderer.update({ disabled: true });
    else if (reason === 'empty') grid.renderer.update({ value: [] });
    else grid.renderer.unmount();
    assert.deepEqual(drawingChanges, [true, false], reason);
    grid.renderer.unmount();
    assert.deepEqual(drawingChanges, [true, false], `${reason} must not release twice`);
  }
});

test('blank-space and disabled touches never suspend parent scrolling', () => {
  const grid = createPatternInput();
  const drawingChanges = [];
  grid.renderer.update({ onDrawingChange: (drawing) => drawingChanges.push(drawing) });
  assert.equal(grid.board().props.onStartShouldSetResponderCapture({ nativeEvent: { locationX: 10, locationY: 10 } }), false);
  grid.draw(10, 10);
  grid.move(40, 200);
  grid.release();
  assert.deepEqual(drawingChanges, []);
  grid.renderer.update({ disabled: true });
  assert.equal(grid.board().props.onStartShouldSetResponderCapture({ nativeEvent: { locationX: 40, locationY: 40 } }), false);
  grid.draw(40, 40);
  assert.deepEqual(drawingChanges, []);
  grid.renderer.unmount();
});

test('opt-in completion fires once on release, snapshots the pattern, and accepts short gestures', () => {
  const grid = createPatternInput();
  const completed = [];
  grid.renderer.update({ onComplete: (pattern) => completed.push(pattern) });
  grid.draw(40, 40);
  grid.move(200, 40);
  grid.move(200, 120);
  assert.equal(completed.length, 0, 'node updates must not complete the gesture');
  grid.release();
  assert.equal(completed.length, 1, 'a node-started gesture must complete exactly once on release');
  assert.deepEqual(Array.from(completed[0]), [0, 1, 2, 5]);
  completed[0].push(8);
  assert.deepEqual(grid.value(), [0, 1, 2, 5], 'completion must not expose the live draft array');
  grid.release();
  grid.move(200, 200);
  assert.equal(completed.length, 1, 'repeated release and post-release moves must not complete again');
  grid.draw(200, 200);
  grid.release();
  assert.deepEqual(Array.from(completed[1]), [8], 'the consumer, not the grid, validates minimum length');
  assert.deepEqual(Array.from(completed[0]), [0, 1, 2, 5, 8], 'a later gesture cannot mutate an earlier snapshot');
  grid.renderer.unmount();
});

test('interrupted gestures never invoke opt-in completion, including stale release after unmount', () => {
  for (const reason of ['terminate', 'clear', 'disable', 'empty', 'unmount']) {
    const grid = createPatternInput();
    const completed = [];
    grid.renderer.update({ onComplete: (pattern) => completed.push(Array.from(pattern)) });
    grid.draw(40, 40);
    grid.move(200, 40);
    const release = grid.board().props.onResponderRelease;
    if (reason === 'terminate') grid.terminate();
    else if (reason === 'clear') grid.clear();
    else if (reason === 'disable') grid.renderer.update({ disabled: true });
    else if (reason === 'empty') grid.renderer.update({ value: [] });
    else grid.renderer.unmount();
    release();
    release();
    assert.deepEqual(completed, [], reason);
    grid.renderer.unmount();
  }
});

test('release never completes if restoring parent scrolling synchronously unmounts the grid', () => {
  const grid = createPatternInput();
  const completed = [];
  const drawingChanges = [];
  grid.renderer.update({
    onComplete: (pattern) => completed.push(Array.from(pattern)),
    onDrawingChange: (drawing) => {
      drawingChanges.push(drawing);
      if (!drawing) grid.renderer.unmount();
    },
  });
  grid.draw(40, 40);
  grid.move(200, 40);
  grid.move(200, 120);
  assert.deepEqual(grid.value(), [0, 1, 2, 5]);
  const release = grid.board().props.onResponderRelease;
  release();
  release();
  assert.deepEqual(drawingChanges, [true, false], 'parent scrolling must be restored exactly once');
  assert.deepEqual(completed, [], 'unmount during the drawing callback must suppress completion');
});

test('release without a node-started gesture never completes even with a previous draft', () => {
  const grid = createPatternInput();
  const completed = [];
  grid.renderer.update({ value: [0, 1, 2, 5], onComplete: (pattern) => completed.push(Array.from(pattern)) });
  grid.release();
  grid.draw(10, 10);
  grid.move(200, 120);
  grid.release();
  grid.renderer.update({ disabled: true });
  grid.draw(40, 40);
  grid.release();
  assert.deepEqual(completed, []);
  grid.renderer.unmount();
});

function nodeAppearance(grid) {
  const nodes = elements(grid.renderer.tree).filter((element) => /^node-/.test(element.props.key || ''));
  assert.equal(nodes.length, 9, 'all nine outer nodes must remain rendered');
  const flatten = (style) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
  return nodes.map((node) => {
    const dots = node.children.filter((child) => child && child.type === 'View');
    assert.equal(dots.length, 1, 'each outer node must contain one inner dot');
    return { key: node.props.key, outer: flatten(node.props.style), dot: flatten(dots[0].props.style) };
  });
}

test('unlock can hide the visible fallback caption without removing accessible grid instructions or setup guidance', () => {
  const grid = createPatternInput();
  const visibleCaption = () => elements(grid.renderer.tree).some((element) =>
    element.type === 'Text' && element.children.some((child) =>
      typeof child === 'string' && child.includes('Kesulitan menggambar pola?')));
  assert.equal(visibleCaption(), true, 'setup shows the caption by default');
  grid.renderer.update({ showAccessibilityCaption: false });
  assert.equal(visibleCaption(), false);
  assert.match(grid.board().props.accessibilityLabel, /PIN 6 digit/);
  assert.match(grid.board().props.accessibilityHint, /minimal 4 titik/);
  grid.draw(40, 40);
  grid.move(200, 40);
  grid.move(200, 120);
  grid.release();
  assert.equal(visibleCaption(), false, 'drawing and release cannot restore the removed caption');
  assert.deepEqual(grid.value(), [0, 1, 2, 5]);
  grid.renderer.update({ showAccessibilityCaption: undefined });
  assert.equal(visibleCaption(), true, 'default setup guidance remains available');
  grid.renderer.unmount();
});

test('unlock can hide the repeat button while release completion and default setup clearing remain available', () => {
  const completed = [];
  const grid = createPatternInput({ showClearButton: false, onComplete: (pattern) => completed.push(Array.from(pattern)) });
  const repeatIsHidden = () => assert.equal(byLabel(grid.renderer.tree, 'Hapus pola'), undefined);
  repeatIsHidden();
  grid.draw(40, 40);
  grid.move(200, 40);
  grid.move(200, 120);
  repeatIsHidden();
  grid.release();
  repeatIsHidden();
  assert.deepEqual(completed, [[0, 1, 2, 5]]);
  grid.draw(200, 200);
  grid.move(40, 200);
  grid.move(40, 120);
  repeatIsHidden();
  grid.release();
  assert.deepEqual(completed, [[0, 1, 2, 5], [8, 7, 6, 3]], 'another drag replaces the previous pattern without a repeat button');
  grid.renderer.update({ showClearButton: undefined });
  assert.ok(byLabel(grid.renderer.tree, 'Hapus pola'), 'setup keeps its repeat button by default');
  grid.clear();
  assert.deepEqual(grid.value(), []);
  grid.renderer.unmount();
});

test('hidden patterns keep every outer node and inner dot identical to empty through release and retries', () => {
  const completed = [];
  const drawingChanges = [];
  const grid = createPatternInput({
    showLines: false,
    onComplete: (pattern) => completed.push(Array.from(pattern)),
    onDrawingChange: (drawing) => drawingChanges.push(drawing),
  });
  const empty = nodeAppearance(grid);
  const unchanged = (phase) => {
    assert.deepEqual(nodeAppearance(grid), empty, phase);
    assert.equal(elements(grid.renderer.tree).some((element) => /^seg-/.test(element.props.key || '')), false);
  };
  grid.draw(40, 40);
  unchanged('the first selected node and active head must stay invisible');
  assert.deepEqual(drawingChanges, [true]);
  for (const [x, y] of [[120, 40], [200, 40], [200, 120], [120, 120], [40, 120], [40, 200], [120, 200], [200, 200]]) {
    grid.move(x, y);
    unchanged(`drawing node at ${x},${y} must not reveal selection or endpoints`);
  }
  assert.deepEqual(grid.value(), [0, 1, 2, 5, 4, 3, 6, 7, 8]);
  assert.deepEqual(completed, [], 'hidden node changes must not verify before release');
  assert.deepEqual(drawingChanges, [true], 'hidden drawing keeps parent scrolling suspended');
  grid.release();
  unchanged('the released endpoints must stay invisible');
  assert.deepEqual(completed, [[0, 1, 2, 5, 4, 3, 6, 7, 8]]);
  assert.deepEqual(drawingChanges, [true, false]);
  grid.renderer.update({ value: [] });
  unchanged('a consumer clearing a failed proof must restore the same hidden baseline');
  grid.draw(200, 200);
  unchanged('a subsequent gesture must not reveal its new active head');
  grid.move(40, 200);
  unchanged('a subsequent midpoint and endpoint must remain invisible');
  assert.deepEqual(grid.value(), [8, 7, 6]);
  grid.release();
  unchanged('a short retry release must remain invisible');
  assert.deepEqual(completed, [[0, 1, 2, 5, 4, 3, 6, 7, 8], [8, 7, 6]]);
  grid.clear();
  unchanged('clear must retain the empty hidden appearance');
  grid.draw(40, 40);
  unchanged('drawing after clear must not leak the active head');
  grid.terminate();
  unchanged('cancellation must retain the empty hidden appearance');
  assert.deepEqual(drawingChanges, [true, false, true, false, true, false]);
  assert.equal(completed.length, 2, 'cancellation never emits another completion');
  grid.renderer.unmount();
});

test('hidden selected first mount stays neutral and toggling visible restores endpoints and active-head feedback', () => {
  const baseline = createPatternInput({ showLines: false });
  const empty = nodeAppearance(baseline);
  baseline.renderer.unmount();
  const grid = createPatternInput({ showLines: false, value: [0, 1, 2, 5] });
  assert.deepEqual(nodeAppearance(grid), empty, 'a selected controlled value must not flash selection on first mount');
  grid.renderer.update({ showLines: true });
  const visible = nodeAppearance(grid);
  assert.notDeepEqual(visible[0].outer, empty[0].outer, 'visible start has outer selection feedback');
  assert.notDeepEqual(visible[0].dot, empty[0].dot, 'visible start has inner endpoint feedback');
  assert.notDeepEqual(visible[1].dot, empty[1].dot, 'visible middle has inner selection feedback');
  assert.notDeepEqual(visible[5].dot, visible[1].dot, 'endpoint and middle feedback remain distinct');
  assert.deepEqual(visible[8], empty[8], 'an unselected node must stay neutral');
  grid.renderer.update({ showLines: false });
  assert.deepEqual(nodeAppearance(grid), empty);
  grid.draw(200, 200);
  assert.deepEqual(grid.value(), [8], 'the next gesture replaces the controlled draft');
  assert.deepEqual(nodeAppearance(grid), empty);
  grid.renderer.update({ showLines: true });
  const active = nodeAppearance(grid);
  assert.notDeepEqual(active[8].outer, empty[8].outer, 'visible active head has outer feedback');
  assert.notDeepEqual(active[8].dot, empty[8].dot, 'visible active endpoint has inner feedback');
  grid.release();
  assert.notDeepEqual(nodeAppearance(grid)[8].outer, active[8].outer, 'release removes active-head feedback only');
  assert.notDeepEqual(nodeAppearance(grid)[8].dot, empty[8].dot, 'released visible endpoint remains selected');
  grid.renderer.update({ showLines: false });
  assert.deepEqual(nodeAppearance(grid), empty);
  grid.renderer.unmount();
});

test('showLines hides pattern feedback without changing node geometry or hit selection', () => {
  const grid = createPatternInput();
  const empty = nodeAppearance(grid);
  grid.draw(40, 40);
  grid.move(200, 40);
  grid.move(200, 120);
  assert.notDeepEqual(nodeAppearance(grid)[0].outer, empty[0].outer, 'default visibility keeps outer selection feedback');
  assert.notDeepEqual(nodeAppearance(grid)[5].dot, empty[5].dot, 'default visibility keeps inner endpoint feedback');
  const segments = () => elements(grid.renderer.tree).filter((element) => /^seg-/.test(element.props.key || ''));
  const nodes = () => elements(grid.renderer.tree).filter((element) => /^node-/.test(element.props.key || ''))
    .map((element) => ({ key: element.props.key, style: Object.assign({}, ...element.props.style.filter(Boolean)) }));
  assert.equal(segments().length, 3, 'connecting lines default to visible');
  const before = nodes().map(({ key, style }) => ({ key, left: style.left, top: style.top }));
  const changeCount = grid.changes.length;
  grid.renderer.update({ showLines: false });
  assert.equal(segments().length, 0);
  assert.equal(nodes().length, 9);
  assert.deepEqual(nodeAppearance(grid), empty, 'hiding an active visible gesture must hide all node feedback');
  assert.deepEqual(nodes().map(({ key, style }) => ({ key, left: style.left, top: style.top })), before,
    'hiding feedback must not change node geometry');
  assert.equal(grid.changes.length, changeCount);
  grid.move(200, 200);
  assert.deepEqual(grid.value(), [0, 1, 2, 5, 8], 'hidden lines must not alter hit selection');
  grid.renderer.update({ showLines: true });
  assert.equal(segments().length, 4);
  grid.renderer.unmount();
});
