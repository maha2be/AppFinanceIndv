/**
 * Regression test for the filter-sheet draft: a parent re-render while the
 * sheet is open must not wipe text the user has typed.
 */
const assert = require('node:assert/strict');
const test = require('node:test');

const { createHarness } = require('./support/screen-harness.cjs');

function node(type, props = {}) {
  const children = props.children === undefined
    ? []
    : (Array.isArray(props.children) ? props.children : [props.children]);
  return { type, props, children };
}

const stub = (type) => (props = {}) => node(type, props);

function mountFilters(overrides = {}) {
  const applied = [];
  const harness = createHarness({
    componentPath: 'components/transactions/TransactionFilters.tsx',
    exportName: 'TransactionFilters',
    props: {
      visible: true,
      filters: {},
      categories: [],
      onApply: (filters) => applied.push(filters),
      onReset: () => {},
      onClose: () => {},
      ...overrides,
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
      [/\.\.\/ui\/Input$/, { Input: (props = {}) => node('Input', props) }],
      [/\.\.\/ui\/Button$/, {
        Button: (props = {}) => node('Pressable', {
          ...props,
          accessibilityRole: 'button',
          accessibilityLabel: props.title,
        }),
      }],
      [/\.\.\/ui\/Chip$/, { Chip: stub('View') }],
      [/\.\.\/ui\/ErrorState$/, { ErrorState: stub('View') }],
      [/\.\.\/ui\/Skeleton$/, { Skeleton: stub('View') }],
    ],
  });
  return { harness, applied };
}

test('typing survives a parent re-render while the sheet stays open', async () => {
  const { harness } = mountFilters();
  await harness.mount();

  harness.changeTestID('filter-start-date', '2026-03-04');
  assert.equal(harness.byTestID('filter-start-date').props.value, '2026-03-04');

  // The screen now passes a new-looking filters object on every parent render.
  // Only visibility changes may re-seed the draft.
  harness.update({ filters: { start_date: '2026-05-06' } });
  harness.update({ categories: [{ id: 1, user_id: 1, type: 'expense', name: 'Kopi', aliases: '', is_default: 0 }] });
  assert.equal(
    harness.byTestID('filter-start-date').props.value,
    '2026-03-04',
    'parent re-render must not wipe typed input'
  );

  // Closing and reopening re-seeds from the latest applied filters.
  harness.update({ visible: false });
  harness.update({ visible: true });
  assert.equal(harness.byTestID('filter-start-date').props.value, '2026-05-06');
});

test('applied values are read from the draft after a parent re-render', async () => {
  const { harness, applied } = mountFilters();
  await harness.mount();

  harness.changeTestID('filter-min-amount', '1.000');
  harness.update({ filters: { max_amount: 500_000 } });
  assert.equal(harness.byTestID('filter-min-amount').props.value, '1.000');

  harness.changeTestID('filter-max-amount', '2.000');
  const apply = harness.byLabel('Terapkan');
  assert.ok(apply, 'the sheet must expose its apply action');
  apply.props.onPress();
  await harness.settle();

  assert.equal(applied.length, 1);
  assert.equal(applied[0].min_amount, 1_000);
  assert.equal(applied[0].max_amount, 2_000);
});