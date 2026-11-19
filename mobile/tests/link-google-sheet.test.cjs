/** Regression coverage for Google linking dismissal during pending requests. */
const assert = require('node:assert/strict');
const test = require('node:test');
const { createHarness, tokenProxy } = require('./support/screen-harness.cjs');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function createLinkHarness(behavior = {}) {
  const calls = { closed: 0, linked: [], requests: [] };
  const harness = createHarness({
    componentPath: 'components/auth/LinkGoogleSheet.tsx',
    exportName: 'LinkGoogleSheet',
    props: {
      visible: true,
      onClose: () => { calls.closed += 1; },
      onLinked: (user) => { calls.linked.push(user); },
    },
    modules: {
      'react-native': { ScrollView: 'ScrollView', Alert: { alert() {} } },
      '../../utils/theme': { Colors: tokenProxy(), Space: tokenProxy(), Type: tokenProxy() },
      '../../services/auth': {
        authApi: {
          linkGoogle: async (params) => {
            calls.requests.push(params);
            return behavior.linkGoogle ? behavior.linkGoogle(params) : { id: 7, google_linked: true };
          },
        },
        describeApiError: () => 'Linking failed.',
      },
      '../../services/googleAuth': {
        isGoogleAuthAvailable: async () => true,
        requestGoogleIdToken: behavior.requestGoogleIdToken || (async () => 'test-id-token'),
      },
      '../../utils/googleError': { describeGoogleError: () => null },
      '../ui/Sheet': {
        Sheet: (props) => ({ type: 'Sheet', props, children: [props.children, props.footer].flat() }),
      },
      '../ui/Button': {
        Button: (props) => ({
          type: 'Pressable',
          props: { ...props, accessibilityLabel: props.title, disabled: Boolean(props.disabled || props.loading) },
          children: [],
        }),
      },
      '../ui/Input': { Input: (props) => ({ type: 'Input', props, children: [] }) },
    },
  });
  return { harness, calls };
}

function startLink(harness) {
  harness.byType('Input').props.onChangeText('password123');
  harness.flush();
  const result = harness.byLabel('Tautkan Google').props.onPress();
  harness.flush();
  return result;
}

test('backdrop and Back dismissal cannot release the guard during a pending Google proof', async () => {
  const pending = deferred();
  const { harness, calls } = createLinkHarness({ requestGoogleIdToken: () => pending.promise });
  await harness.mount();
  const result = startLink(harness);
  await harness.settle();

  harness.byType('Sheet').props.onClose();
  harness.flush();
  assert.equal(calls.closed, 0);
  assert.equal(harness.byLabel('Tautkan Google').props.disabled, true);
  assert.equal(harness.byLabel('Batal').props.disabled, true);

  pending.resolve('test-id-token');
  await result;
  await harness.settle();
  assert.equal(calls.requests.length, 1);
  assert.equal(calls.linked.length, 1);
  assert.equal(harness.byLabel('Tautkan Google').props.disabled, false);
});

test('dismissal stays blocked while the backend is linking the selected Google account', async () => {
  const pending = deferred();
  const { harness, calls } = createLinkHarness({ linkGoogle: () => pending.promise });
  await harness.mount();
  const result = startLink(harness);
  await harness.settle();
  assert.equal(calls.requests.length, 1);

  harness.byType('Sheet').props.onClose();
  harness.flush();
  assert.equal(calls.closed, 0);
  assert.equal(harness.byLabel('Batal').props.disabled, true);

  pending.resolve({ id: 7, google_linked: true });
  await result;
  await harness.settle();
  assert.equal(calls.linked.length, 1);
});

test('a failed Google link permits dismissal and clears the password draft', async () => {
  const { harness, calls } = createLinkHarness({ linkGoogle: async () => { throw new Error('network'); } });
  await harness.mount();
  await startLink(harness);
  await harness.settle();
  assert.equal(calls.linked.length, 0);
  assert.equal(harness.byLabel('Batal').props.disabled, false);
  harness.byType('Sheet').props.onClose();
  harness.flush();
  assert.equal(calls.closed, 1);
  assert.equal(harness.byType('Input').props.value, '');
});

test('cancelled native Google proof permits dismissal without linking an account', async () => {
  const { harness, calls } = createLinkHarness({ requestGoogleIdToken: async () => null });
  await harness.mount();
  await startLink(harness);
  await harness.settle();
  harness.byType('Sheet').props.onClose();
  harness.flush();
  assert.equal(calls.closed, 1);
  assert.equal(calls.requests.length, 0);
  assert.equal(calls.linked.length, 0);
});
