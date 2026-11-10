/**
 * Contract tests for the real numbered pager and its page-jump Sheet.
 *
 * The component is mounted directly with the shared harness; only the visual
 * primitives it composes (Sheet, Button, react-native host components) are
 * stubbed. Page-token and jump rules come from the real production helpers.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { createHarness } = require('./support/screen-harness.cjs');

const COMPONENT_PATH = 'components/transactions/TransactionPagination.tsx';

function node(type, props = {}) {
  const children = props.children === undefined
    ? []
    : (Array.isArray(props.children) ? props.children : [props.children]);
  return { type, props, children };
}

const stub = (type) => (props = {}) => node(type, props);

function mountPagination(props = {}) {
  const onSelectPage = [];
  const harness = createHarness({
    componentPath: COMPONENT_PATH,
    exportName: 'TransactionPagination',
    props: {
      currentPage: 1,
      totalPages: 99,
      disabled: false,
      onSelectPage: (page) => onSelectPage.push(page),
      ...props,
    },
    modules: {
      'react-native': {
        ScrollView: stub('ScrollView'),
        TextInput: stub('TextInput'),
      },
    },
    moduleFallback: [
      [/\.\.\/ui\/Sheet$/, {
        Sheet: (props = {}) => (props.visible ? node('View', props) : null),
      }],
      [/\.\.\/ui\/Button$/, {
        Button: (props = {}) => node('Pressable', {
          ...props,
          accessibilityRole: 'button',
          accessibilityLabel: props.title,
          disabled: Boolean(props.disabled),
        }),
      }],
    ],
  });
  return { harness, onSelectPage };
}

function tokenIDs(harness) {
  return harness.elements()
    .filter((element) => typeof element.props.testID === 'string'
      && element.props.testID.startsWith('page-'))
    .map((element) => element.props.testID);
}

function pageTokens(harness) {
  return tokenIDs(harness).filter((testID) => /^page-\d+$/.test(testID));
}

function selectedToken(harness) {
  const selected = harness.elements().filter((element) =>
    typeof element.props.testID === 'string'
    && /^page-\d+$/.test(element.props.testID)
    && element.props.accessibilityState?.selected === true);
  return selected.map((element) => element.props.testID);
}

function jumpSheetOpen(harness) {
  return Boolean(harness.byTestID('page-jump-input'));
}

async function openJumpSheet(harness, side = 'page-ellipsis-right') {
  assert.ok(harness.byTestID(side), `${side} must be rendered`);
  await harness.pressTestID(side);
  assert.ok(jumpSheetOpen(harness), 'ellipsis must open the jump sheet');
}

/* ------------------------------------------------------------------ */
/* Strip tokens                                                        */
/* ------------------------------------------------------------------ */

test('99-page strip on page one shows the leading neighbours and right ellipsis', async () => {
  const { harness } = mountPagination({ currentPage: 1, totalPages: 99 });
  await harness.mount();

  for (const testID of ['page-1', 'page-2', 'page-3', 'page-ellipsis-right', 'page-99']) {
    assert.ok(harness.byTestID(testID), `${testID} must be rendered`);
  }
  assert.equal(harness.byTestID('page-ellipsis-left'), undefined);
  assert.deepEqual(selectedToken(harness), ['page-1']);
});

test('99-page strip on page five shows both ellipses and the neighbours', async () => {
  const { harness } = mountPagination({ currentPage: 5, totalPages: 99 });
  await harness.mount();

  for (const testID of [
    'page-1', 'page-ellipsis-left', 'page-4', 'page-5', 'page-6',
    'page-ellipsis-right', 'page-99',
  ]) {
    assert.ok(harness.byTestID(testID), `${testID} must be rendered`);
  }
  assert.equal(harness.byTestID('page-2'), undefined);
  assert.equal(harness.byTestID('page-7'), undefined);
  assert.deepEqual(selectedToken(harness), ['page-5']);
});

test('99-page strip on the last page shows the trailing neighbours', async () => {
  const { harness } = mountPagination({ currentPage: 99, totalPages: 99 });
  await harness.mount();

  for (const testID of ['page-1', 'page-ellipsis-left', 'page-97', 'page-98', 'page-99']) {
    assert.ok(harness.byTestID(testID), `${testID} must be rendered`);
  }
  assert.equal(harness.byTestID('page-ellipsis-right'), undefined);
  assert.deepEqual(selectedToken(harness), ['page-99']);
});

test('few pages show every number and hide the pager when there are none', async () => {
  const small = mountPagination({ currentPage: 2, totalPages: 5 });
  await small.harness.mount();
  assert.deepEqual(pageTokens(small.harness), [
    'page-1', 'page-2', 'page-3', 'page-4', 'page-5',
  ]);

  const empty = mountPagination({ currentPage: 1, totalPages: 0 });
  await empty.harness.mount();
  assert.equal(empty.harness.byTestID('page-prev'), undefined);
  assert.equal(empty.harness.byTestID('page-next'), undefined);
});

/* ------------------------------------------------------------------ */
/* Previous / next                                                     */
/* ------------------------------------------------------------------ */

test('previous is absent on page one and next reports one page forward', async () => {
  const { harness, onSelectPage } = mountPagination({ currentPage: 1, totalPages: 99 });
  await harness.mount();

  assert.equal(harness.byTestID('page-prev'), undefined);
  assert.ok(harness.byTestID('page-next'));

  await harness.pressTestID('page-next');
  assert.deepEqual(onSelectPage, [2]);
});

test('next is absent on the last page and previous reports one page back', async () => {
  const { harness, onSelectPage } = mountPagination({ currentPage: 99, totalPages: 99 });
  await harness.mount();

  assert.equal(harness.byTestID('page-next'), undefined);
  assert.ok(harness.byTestID('page-prev'));

  await harness.pressTestID('page-prev');
  assert.deepEqual(onSelectPage, [98]);
});

test('interior pages show both controls with correct targets', async () => {
  const { harness, onSelectPage } = mountPagination({ currentPage: 5, totalPages: 99 });
  await harness.mount();

  assert.ok(harness.byTestID('page-prev'));
  assert.ok(harness.byTestID('page-next'));
  await harness.pressTestID('page-prev');
  await harness.pressTestID('page-next');
  assert.deepEqual(onSelectPage, [4, 6]);
});

test('a numbered token reports exactly its own page', async () => {
  const { harness, onSelectPage } = mountPagination({ currentPage: 5, totalPages: 99 });
  await harness.mount();

  await harness.pressTestID('page-6');
  assert.deepEqual(onSelectPage, [6]);

  await harness.pressTestID('page-4');
  assert.deepEqual(onSelectPage, [6, 4]);

  // The current token stays selected and never triggers a duplicate request.
  const current = harness.byTestID('page-5');
  current.props.onPress();
  assert.deepEqual(onSelectPage, [6, 4]);
});

test('loading disables the controls that still exist', async () => {
  const { harness, onSelectPage } = mountPagination({
    currentPage: 5,
    totalPages: 99,
    disabled: true,
  });
  await harness.mount();

  assert.equal(harness.byTestID('page-prev').props.disabled, true);
  assert.equal(harness.byTestID('page-next').props.disabled, true);
  assert.equal(harness.byTestID('page-4').props.disabled, true);
  assert.equal(harness.byTestID('page-ellipsis-right').props.disabled, true);
  assert.deepEqual(onSelectPage, []);
});

test('loading keeps the next control on page one and hides the absent previous', async () => {
  const { harness } = mountPagination({ currentPage: 1, totalPages: 99, disabled: true });
  await harness.mount();

  assert.equal(harness.byTestID('page-prev'), undefined);
  assert.equal(harness.byTestID('page-next').props.disabled, true);
});

/* ------------------------------------------------------------------ */
/* Jump sheet                                                          */
/* ------------------------------------------------------------------ */

test('ellipsis opens the jump sheet from either side', async () => {
  const right = mountPagination({ currentPage: 5, totalPages: 99 });
  await right.harness.mount();
  await openJumpSheet(right.harness, 'page-ellipsis-right');
  assert.match(right.harness.texts().join(''), /1-99/);

  const left = mountPagination({ currentPage: 5, totalPages: 99 });
  await left.harness.mount();
  await openJumpSheet(left.harness, 'page-ellipsis-left');
});

test('a valid jump reports the page and closes the sheet', async () => {
  const { harness, onSelectPage } = mountPagination({ currentPage: 5, totalPages: 99 });
  await harness.mount();
  await openJumpSheet(harness);

  harness.changeTestID('page-jump-input', ' 42 ');
  await harness.pressTestID('page-jump-submit');

  assert.deepEqual(onSelectPage, [42]);
  assert.equal(jumpSheetOpen(harness), false);
});

test('invalid jumps show the range error and never report a page', async () => {
  const { harness, onSelectPage } = mountPagination({ currentPage: 5, totalPages: 99 });
  await harness.mount();
  await openJumpSheet(harness);

  for (const value of ['100', 'abc', '', '0', '1.5']) {
    harness.changeTestID('page-jump-input', value);
    await harness.pressTestID('page-jump-submit');
    assert.equal(onSelectPage.length, 0, `${value} must not select a page`);
    assert.ok(jumpSheetOpen(harness), `${value} must keep the sheet open`);
    const error = harness.byTestID('page-jump-error');
    assert.ok(error, `${value} must show the error`);
    assert.equal(
      harness.texts().find((text) => text.includes('Masukkan halaman 1 sampai 99.')),
      'Masukkan halaman 1 sampai 99.',
      value
    );
  }
});

test('jumping to the current page closes without reporting', async () => {
  const { harness, onSelectPage } = mountPagination({ currentPage: 5, totalPages: 99 });
  await harness.mount();
  await openJumpSheet(harness);

  harness.changeTestID('page-jump-input', '5');
  await harness.pressTestID('page-jump-submit');

  assert.deepEqual(onSelectPage, []);
  assert.equal(jumpSheetOpen(harness), false);
});

test('cancel closes the jump sheet without reporting', async () => {
  const { harness, onSelectPage } = mountPagination({ currentPage: 5, totalPages: 99 });
  await harness.mount();
  await openJumpSheet(harness);

  harness.changeTestID('page-jump-input', '9');
  await harness.press('Batal');

  assert.deepEqual(onSelectPage, []);
  assert.equal(jumpSheetOpen(harness), false);
});

test('jump submit is disabled and inert while the pager is disabled', async () => {
  const { harness, onSelectPage } = mountPagination({ currentPage: 5, totalPages: 99 });
  await harness.mount();
  await openJumpSheet(harness);
  harness.changeTestID('page-jump-input', '9');

  harness.update({ disabled: true });
  const submit = harness.byTestID('page-jump-submit');
  assert.equal(submit.props.disabled, true);
  submit.props.onPress();
  await harness.settle();
  assert.deepEqual(onSelectPage, []);
  assert.ok(jumpSheetOpen(harness));
});
