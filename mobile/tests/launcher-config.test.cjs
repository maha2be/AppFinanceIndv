/**
 * Launcher configuration tests.
 *
 * The PNG files are parsed directly from their bytes (signature, IHDR and the
 * inflated IDAT payload) so the check needs no image library and no native
 * build. Expo requires a 1024x1024 8-bit RGBA source icon for adaptive icons.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');

const root = path.join(__dirname, '..');
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function readPng(relativePath) {
  const file = path.join(root, relativePath);
  assert.ok(fs.existsSync(file), `missing launcher asset ${relativePath}`);
  const bytes = fs.readFileSync(file);
  assert.deepEqual(bytes.subarray(0, 8), PNG_SIGNATURE, `${relativePath} is not a PNG`);

  let offset = 8;
  let header = null;
  const idat = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  assert.ok(header, `${relativePath} has no IHDR chunk`);
  assert.equal(header.width, 1024, `${relativePath} width`);
  assert.equal(header.height, 1024, `${relativePath} height`);
  assert.equal(header.bitDepth, 8, `${relativePath} bit depth`);
  assert.equal(header.colorType, 6, `${relativePath} must be RGBA`);
  assert.equal(header.compression, 0);
  assert.equal(header.filter, 0);
  assert.equal(header.interlace, 0, `${relativePath} must not be interlaced`);

  const pixels = zlib.inflateSync(Buffer.concat(idat));
  assert.equal(
    pixels.length,
    header.height * (1 + header.width * 4),
    `${relativePath} pixel payload size`,
  );
  return { bytes, pixels };
}

function pngPaths() {
  return {
    icon: app.icon?.replace(/^\.\//, ''),
    foreground: app.android?.adaptiveIcon?.foregroundImage?.replace(/^\.\//, ''),
    monochrome: app.android?.adaptiveIcon?.monochromeImage?.replace(/^\.\//, ''),
  };
}

test('app.json declares the restored icon and adaptive icon layers', () => {
  assert.equal(app.icon, './assets/images/icon.png');
  assert.equal(
    app.android?.adaptiveIcon?.foregroundImage,
    './assets/images/adaptive-icon.png',
  );
  assert.equal(
    app.android?.adaptiveIcon?.monochromeImage,
    './assets/images/monochrome-icon.png',
  );
  assert.match(
    String(app.android?.adaptiveIcon?.backgroundColor ?? ''),
    /^#[0-9A-Fa-f]{6}$/,
    'adaptive icon needs an opaque hex background color',
  );
});

test('every configured launcher PNG is a valid 1024x1024 RGBA image', () => {
  const paths = pngPaths();
  for (const [role, relativePath] of Object.entries(paths)) {
    assert.ok(relativePath, `${role} icon path must be configured`);
    readPng(relativePath);
  }
});

test('launcher assets are included in the EAS upload context', () => {
  // EAS reads .easignore from the Git repository root, even when run in mobile/.
  const ignorePath = path.join(root, '..', '.easignore');
  assert.ok(fs.existsSync(ignorePath), 'repo-root .easignore must exist');
  const ignore = require('ignore');
  const matcher = ignore().add(fs.readFileSync(ignorePath, 'utf8'));

  for (const relativePath of Object.values(pngPaths())) {
    const repoPath = path.posix.join('mobile', relativePath);
    assert.equal(
      matcher.ignores(repoPath),
      false,
      `${repoPath} must stay in the EAS upload context`,
    );
  }
  assert.equal(matcher.ignores('mobile/app.json'), false, 'app.json must be uploaded');
  assert.equal(matcher.ignores('mobile/tests/launcher-config.test.cjs'), true,
    'test files remain excluded');
});