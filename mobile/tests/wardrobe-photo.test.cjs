const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the actual handlers without Expo, a device, or paid AI calls.
const app = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');
const handlers = app.slice(app.indexOf('  const handleAddPhoto ='), app.indexOf('// ANA İŞLEME VE GEMINI ANALİZİ'));

function setup({ platform = 'web', result, denied = false, failure = false, full = false } = {}) {
  const calls = [];
  const state = {};
  const record = name => value => { state[name] = value; };
  const picker = source => options => {
    calls.push({ source, options });
    return failure ? Promise.reject(new Error('Unavailable')) : Promise.resolve(result ?? {
      canceled: false, assets: [{ uri: 'photo.jpg', base64: 'aW1hZ2U=' }],
    });
  };
  const permission = async () => {
    calls.push({ source: 'permission' });
    return { granted: !denied };
  };
  const context = {
    Platform: { OS: platform }, lang: 'tr', isProUser: false,
    wardrobe: full ? [1] : [], FREE_ITEM_LIMIT: 1,
    setPhotoPickerVisible: record('visible'), setPhotoPickerError: record('error'),
    setProModalVisible: record('pro'),
    showAlert: (...args) => calls.push({ source: 'alert', args }),
    ImagePicker: {
      MediaTypeOptions: { Images: 'Images' },
      launchCameraAsync: picker('camera'), launchImageLibraryAsync: picker('gallery'),
      requestCameraPermissionsAsync: permission, requestMediaLibraryPermissionsAsync: permission,
    },
    processAndAnalyzeImage: (...args) => calls.push({ source: 'analyze', args }),
    console: { log() {} },
  };
  vm.createContext(context);
  vm.runInContext(`${handlers}\nthis.actions = { handleAddPhoto, openCamera, openGallery };`, context);
  return { ...context.actions, state, calls };
}

test('web add button opens the menu without calling native Alert', () => {
  const app = setup();
  app.handleAddPhoto();
  assert.equal(app.state.visible, true);
  assert.equal(app.state.error, '');
  assert.equal(app.calls.length, 0);
});

for (const source of ['Camera', 'Gallery']) {
  test(`web ${source} opens synchronously from the click, then analyzes the selected image`, async () => {
    const app = setup();
    const pending = app[`open${source}`]();
    assert.equal(app.calls[0].source, source.toLowerCase());
    assert.equal(app.calls[0].options.base64, true);
    await pending;
    assert.equal(app.state.visible, false);
    assert.deepEqual(app.calls[1], { source: 'analyze', args: ['photo.jpg', 'aW1hZ2U=', 'image/jpeg'] });
  });
}

test('canceling never sends a photo for analysis', async () => {
  const app = setup({ result: { canceled: true } });
  app.handleAddPhoto();
  await app.openGallery();
  assert.equal(app.state.visible, true);
  assert.equal(app.calls.length, 1);
});

for (const options of [{ failure: true }, { result: { canceled: false, assets: [] } }, { result: { canceled: false, assets: [{ uri: 'photo.jpg' }] } }]) {
  test(`web shows a recoverable error for ${JSON.stringify(options)}`, async () => {
    const app = setup(options);
    app.handleAddPhoto();
    await app.openCamera();
    assert.ok(app.state.error);
    assert.equal(app.state.visible, true);
    assert.equal(app.calls.length, 1);
  });
}

test('free limit opens the upgrade screen without accessing photos', async () => {
  const app = setup({ full: true });
  await app.openCamera();
  assert.equal(app.state.pro, true);
  assert.equal(app.state.visible, false);
  assert.equal(app.calls.length, 0);
});

test('native menu still offers camera, gallery, and cancel', () => {
  const app = setup({ platform: 'ios' });
  app.handleAddPhoto();
  assert.deepEqual(Array.from(app.calls[0].args[2], button => button.text), ['Kamera', 'Galeri', 'İptal']);
});

test('native permission denial stops before opening the camera', async () => {
  const app = setup({ platform: 'android', denied: true });
  await app.openCamera();
  assert.deepEqual(app.calls.map(call => call.source), ['permission', 'alert']);
});

test('native permission success opens the gallery and analyzes the photo', async () => {
  const app = setup({ platform: 'ios' });
  await app.openGallery();
  assert.deepEqual(app.calls.map(call => call.source), ['permission', 'gallery', 'analyze']);
});
