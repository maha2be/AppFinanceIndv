/** Scroll suspension must preserve the screen's ScrollView and its content. */
const assert = require('node:assert/strict');
const test = require('node:test');
const { createHarness, tokenProxy } = require('./support/screen-harness.cjs');

test('Screen forwards scrollEnabled and keeps its ScrollView mounted', async (t) => {
  const harness = createHarness({
    componentPath: 'components/ui/Screen.tsx',
    exportName: 'Screen',
    modules: {
      'react-native': {
        ScrollView: 'ScrollView', KeyboardAvoidingView: 'KeyboardAvoidingView',
        RefreshControl: 'RefreshControl', Platform: { OS: 'android' },
      },
      'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
      '../../utils/theme': { Colors: tokenProxy(), Space: tokenProxy() },
    },
  });
  t.after(() => harness.unmount());
  await harness.mount();
  assert.equal(harness.byType('ScrollView').props.scrollEnabled, true);
  harness.update({ scrollEnabled: false });
  assert.equal(harness.byType('ScrollView').props.scrollEnabled, false);
  harness.update({ scrollEnabled: true });
  assert.equal(harness.byType('ScrollView').props.scrollEnabled, true);
});
