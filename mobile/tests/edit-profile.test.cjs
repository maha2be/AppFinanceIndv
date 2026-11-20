/**
 * Runtime regressions for EditProfileSheet and profilePhoto helper.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createHarness, loadTsModule, mobileRoot, tokenProxy } = require('./support/screen-harness.cjs');

function node(type, props = {}) {
  const children = props.children === undefined ? [] : [props.children].flat(Infinity);
  return { type, props, children };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function createEditProfileHarness(options = {}) {
  const calls = {
    closed: 0,
    saved: [],
    picks: [],
    updates: [],
  };
  const behavior = {
    pickProfilePhoto: async () => 'data:image/jpeg;base64,/9j/NEWPHOTO',
    updateProfile: async (params) => ({
      id: 7,
      email: 'ayu@example.test',
      first_name: params.first_name ?? (options.user?.first_name ?? 'Ayu'),
      avatar_url: params.avatar_url !== undefined ? params.avatar_url : (options.user?.avatar_url ?? null),
      timezone: 'Asia/Jakarta',
      currency: 'IDR',
      ...options.updatedOverride,
    }),
    ...options.behavior,
  };

  const user = options.user === undefined
    ? {
        id: 7,
        email: 'ayu@example.test',
        first_name: 'Ayu',
        avatar_url: null,
        timezone: 'Asia/Jakarta',
        currency: 'IDR',
      }
    : options.user;

  const harness = createHarness({
    componentPath: 'components/profile/EditProfileSheet.tsx',
    exportName: 'EditProfileSheet',
    props: {
      visible: options.visible ?? true,
      user,
      onClose: () => { calls.closed += 1; },
      onSaved: (updated) => { calls.saved.push(updated); },
    },
    modules: {
      'react-native': {
        Image: (props) => node('Image', props),
        ScrollView: (props) => node('ScrollView', props),
      },
      '../../utils/theme': {
        Colors: tokenProxy(),
        Fonts: tokenProxy(),
        Radius: tokenProxy(),
        Space: tokenProxy(),
        Type: tokenProxy(),
      },
      '../../services/auth': {
        authApi: {
          updateProfile: (params) => {
            calls.updates.push(params);
            return behavior.updateProfile(params);
          },
        },
        describeApiError: (error, fallback) => error?.response?.data?.detail || fallback,
      },
      '../../services/profilePhoto': {
        pickProfilePhoto: (source) => {
          calls.picks.push(source);
          return behavior.pickProfilePhoto(source);
        },
      },
      '../ui/Sheet': {
        Sheet: (props) => (props.visible
          ? { type: 'Sheet', props, children: [props.children, props.footer].flat() }
          : null),
      },
      '../ui/Input': {
        Input: (props) => node('Input', props),
      },
      '../ui/Button': {
        Button: (props) => node('Pressable', {
          ...props,
          accessibilityRole: 'button',
          accessibilityLabel: props.title,
          disabled: Boolean(props.disabled || props.loading),
        }),
      },
    },
  });

  return { harness, calls, behavior };
}

test('Simpan stays disabled until name or photo changes, and parent re-renders preserve edits', async () => {
  const { harness, calls } = createEditProfileHarness();
  await harness.mount();

  assert.equal(harness.byLabel('Simpan').props.disabled, true);
  harness.change('Nama profil', 'Ayu Lestari');
  assert.equal(harness.byLabel('Simpan').props.disabled, false);

  // Parent re-render while open must not wipe unsaved edits.
  harness.update({ user: { id: 7, first_name: 'Old Name', avatar_url: null, timezone: 'Asia/Jakarta', currency: 'IDR' } });
  assert.equal(harness.byLabel('Nama profil').props.value, 'Ayu Lestari');

  await harness.press('Simpan');
  assert.deepEqual(JSON.parse(JSON.stringify(calls.updates)), [{ first_name: 'Ayu Lestari' }]);
  assert.equal(calls.saved.length, 1);
  assert.equal(calls.saved[0].first_name, 'Ayu Lestari');
});

test('blank name shows validation error and never calls updateProfile', async () => {
  const { harness, calls } = createEditProfileHarness();
  await harness.mount();

  harness.change('Nama profil', '   ');
  await harness.press('Simpan');

  assert.deepEqual(calls.updates, []);
  assert.ok(harness.texts().includes('Nama tidak boleh kosong.'));
});

test('gallery and camera picking update avatar preview and send only avatar_url when name is unchanged', async () => {
  const { harness, calls } = createEditProfileHarness();
  await harness.mount();

  assert.equal(harness.byType('Image'), undefined);
  await harness.press('Pilih foto dari galeri');
  assert.deepEqual(calls.picks, ['library']);
  assert.equal(harness.byType('Image').props.source.uri, 'data:image/jpeg;base64,/9j/NEWPHOTO');
  assert.equal(harness.byLabel('Simpan').props.disabled, false);

  await harness.press('Simpan');
  assert.deepEqual(
    JSON.parse(JSON.stringify(calls.updates)),
    [{ avatar_url: 'data:image/jpeg;base64,/9j/NEWPHOTO' }]
  );
  assert.equal(calls.saved.length, 1);
});

test('removing an existing photo sends avatar_url null without modifying name', async () => {
  const { harness, calls } = createEditProfileHarness({
    user: {
      id: 7,
      first_name: 'Ayu',
      avatar_url: 'data:image/jpeg;base64,/9j/EXISTING',
      timezone: 'Asia/Jakarta',
      currency: 'IDR',
    },
  });
  await harness.mount();

  assert.equal(harness.byType('Image').props.source.uri, 'data:image/jpeg;base64,/9j/EXISTING');
  await harness.press('Hapus foto profil');
  assert.equal(harness.byType('Image'), undefined);
  assert.equal(harness.byLabel('Simpan').props.disabled, false);

  await harness.press('Simpan');
  assert.deepEqual(JSON.parse(JSON.stringify(calls.updates)), [{ avatar_url: null }]);
  assert.equal(calls.saved[0].avatar_url, null);
});

test('pending save blocks dismissal, photo picking, and duplicate submissions', async () => {
  const pending = deferred();
  const { harness, calls } = createEditProfileHarness({
    behavior: { updateProfile: () => pending.promise },
  });
  await harness.mount();

  harness.change('Nama profil', 'Nama Baru');
  const savePromise = harness.byLabel('Simpan').props.onPress();
  harness.flush();

  assert.equal(calls.updates.length, 1);
  assert.equal(harness.byLabel('Batal').props.disabled, true);
  assert.equal(harness.byLabel('Pilih foto dari galeri').props.disabled, true);
  assert.equal(harness.byLabel('Ambil foto dengan kamera').props.disabled, true);

  harness.byType('Sheet').props.onClose();
  await harness.byLabel('Simpan').props.onPress();
  harness.flush();
  assert.equal(calls.closed, 0);
  assert.equal(calls.updates.length, 1);

  pending.resolve({ id: 7, first_name: 'Nama Baru', avatar_url: null, timezone: 'Asia/Jakarta', currency: 'IDR' });
  await savePromise;
  await harness.settle();
  assert.equal(calls.saved.length, 1);
});

test('failed save reports error and retains draft for retry', async () => {
  const { harness, calls } = createEditProfileHarness({
    behavior: {
      updateProfile: async () => {
        throw { response: { data: { detail: 'Ukuran foto profil terlalu besar.' } } };
      },
    },
  });
  await harness.mount();

  harness.change('Nama profil', 'Nama Tetap');
  await harness.press('Simpan');

  assert.equal(calls.saved.length, 0);
  assert.ok(harness.texts().includes('Ukuran foto profil terlalu besar.'));
  assert.equal(harness.byLabel('Nama profil').props.value, 'Nama Tetap');
  assert.equal(harness.byLabel('Simpan').props.disabled, false);
});

test('pickProfilePhoto requests permission, resizes via ImageManipulator, and handles cancellation', async () => {
  let granted = true;
  let canceled = false;
  const resizeCalls = [];
  const helper = loadTsModule(path.join(mobileRoot, 'services/profilePhoto.ts'), (name) => {
    if (name === 'react-native') return { Platform: { OS: 'android' } };
    if (name === 'expo-image-picker') {
      return {
        requestMediaLibraryPermissionsAsync: async () => ({ granted }),
        requestCameraPermissionsAsync: async () => ({ granted }),
        launchImageLibraryAsync: async () => (
          canceled
            ? { canceled: true, assets: null }
            : { canceled: false, assets: [{ uri: 'file:///photo.jpg', base64: 'RAW', mimeType: 'image/jpeg' }] }
        ),
        launchCameraAsync: async () => ({
          canceled: false,
          assets: [{ uri: 'file:///cam.jpg', base64: 'CAM', mimeType: 'image/jpeg' }],
        }),
      };
    }
    if (name === 'expo-image-manipulator') {
      return {
        SaveFormat: { JPEG: 'jpeg' },
        ImageManipulator: {
          manipulate: (uri) => ({
            resize: (size) => {
              resizeCalls.push({ uri, size });
              return {
                renderAsync: async () => ({
                  saveAsync: async () => ({ uri: 'file:///small.jpg', base64: 'U01BTEw=' }),
                }),
              };
            },
          }),
        },
      };
    }
    throw new Error(`Unexpected module in profilePhoto: ${name}`);
  });

  const result = await helper.pickProfilePhoto('library');
  assert.equal(result, 'data:image/jpeg;base64,U01BTEw=');
  assert.deepEqual(
    JSON.parse(JSON.stringify(resizeCalls)),
    [{ uri: 'file:///photo.jpg', size: { width: 256, height: 256 } }]
  );

  canceled = true;
  assert.equal(await helper.pickProfilePhoto('library'), null);

  granted = false;
  await assert.rejects(() => helper.pickProfilePhoto('camera'), /Izin kamera ditolak/);
});
